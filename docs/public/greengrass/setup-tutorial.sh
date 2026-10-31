#!/usr/bin/env bash
# 
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
# 
set -euo pipefail

STATE_FILE_DEFAULT=".greengrass-tutorial.env"
CANONICAL_OWNER_ID="099720109477"
UBUNTU_AMI_NAME_FRAGMENT="ubuntu-resolute-26.04-amd64-server"
NUCLEUS_VERSION="2.18.3"
NUCLEUS_URL="https://d2s8p88vqu9w66.cloudfront.net/releases/greengrass-${NUCLEUS_VERSION}.zip"
MQTT_TOPIC="tutorial/greengrass/heartbeat"
# Seconds between status polls. Tests set it to 0.
POLL_SECONDS="${GREENGRASS_TUTORIAL_POLL_SECONDS:-15}"
IOT_NOT_FOUND='ResourceNotFoundException'
IAM_NOT_FOUND='NoSuchEntity'
EC2_NOT_FOUND='InvalidInstanceID\.NotFound|InvalidInstanceID\.Malformed'

usage() {
  cat <<'EOF'
Usage:
  setup-tutorial.sh setup   --profile PROFILE --region REGION --prefix PREFIX \
                            --ami-id AMI_ID --instance-profile INSTANCE_PROFILE_NAME \
                            [--instance-type t3.small] [--subnet-id SUBNET_ID] \
                            [--state-file .greengrass-tutorial.env]
  setup-tutorial.sh cleanup --profile PROFILE --region REGION --prefix PREFIX \
                            [--state-file .greengrass-tutorial.env]

PREFIX names every resource: PREFIX-core, PREFIX-group, PREFIX-token-exchange,
PREFIX-token-exchangeAccess, PREFIX-alias and PREFIX-device-policy. The script
refuses to adopt a resource that already exists under one of those names.

AMI_ID must be a Canonical Ubuntu 26.04 amd64 server image in REGION. Find it with:
  aws --profile PROFILE --region REGION ssm get-parameter \
    --name /aws/service/canonical/ubuntu/server/26.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value --output text

INSTANCE_PROFILE_NAME is an instance profile you own. Its role needs
AmazonSSMManagedInstanceCore plus the temporary installer permissions listed in
the tutorial. Remove the temporary permissions after setup succeeds.
EOF
}

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
operation="${1:-}"
if [[ -n "$operation" ]]; then shift; fi
profile=""; region=""; prefix=""; ami_id=""; instance_profile=""
instance_type="t3.small"; subnet_id=""; state_file="$STATE_FILE_DEFAULT"
while (($#)); do
  case "$1" in
    --profile) profile="${2:?--profile needs a value}"; shift 2 ;;
    --region) region="${2:?--region needs a value}"; shift 2 ;;
    --prefix) prefix="${2:?--prefix needs a value}"; shift 2 ;;
    --ami-id) ami_id="${2:?--ami-id needs a value}"; shift 2 ;;
    --instance-profile) instance_profile="${2:?--instance-profile needs a value}"; shift 2 ;;
    --instance-type) instance_type="${2:?--instance-type needs a value}"; shift 2 ;;
    --subnet-id) subnet_id="${2:?--subnet-id needs a value}"; shift 2 ;;
    --state-file) state_file="${2:?--state-file needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done
case "$operation" in
  setup|cleanup) ;;
  *) usage >&2; exit 2 ;;
esac
if [[ -z "$profile" || -z "$region" || -z "$prefix" ]]; then
  usage >&2; die "--profile, --region and --prefix are required"
fi
if [[ "$operation" == "setup" && ( -z "$ami_id" || -z "$instance_profile" ) ]]; then
  usage >&2; die "setup requires --ami-id and --instance-profile"
fi
[[ "$prefix" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$ ]] ||
  die "--prefix must be 1-40 letters, digits, hyphens or underscores"

aws_cli=(aws --profile "$profile" --region "$region")
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

# ---------------------------------------------------------------------------
# AWS CLI helpers
# ---------------------------------------------------------------------------

# Runs an AWS CLI command. A failure aborts the script with the CLI's own error.
aws_run() {
  "${aws_cli[@]}" "$@"
}

# Runs a delete whose target may already be gone. Prints "deleted" on success
# and "absent" when the error matches the given not-found pattern. Any other
# error aborts, so a retry after a partial run tolerates exactly the missing
# objects and nothing else.
aws_delete() {
  local pattern="$1"; shift
  local err="$work_dir/err"
  if "${aws_cli[@]}" "$@" >/dev/null 2>"$err"; then
    printf 'deleted'
    return 0
  fi
  if grep -Eq "$pattern" "$err"; then
    printf 'absent'
    return 0
  fi
  cat "$err" >&2
  die "cleanup stopped at: aws $*. Fix the cause and rerun cleanup; the state file is kept."
}

# Runs a read that answers "does this exist". Prints "yes" or "no"; aborts on
# any error other than the not-found pattern.
aws_exists() {
  local pattern="$1"; shift
  local err="$work_dir/err"
  if "${aws_cli[@]}" "$@" >/dev/null 2>"$err"; then
    printf 'yes'
    return 0
  fi
  if grep -Eq "$pattern" "$err"; then
    printf 'no'
    return 0
  fi
  cat "$err" >&2
  die "could not check whether a resource exists: aws $*"
}

# Runs a read whose absence is an empty result. Prints the command output, or
# nothing when the error matches the not-found pattern.
aws_read_or_empty() {
  local pattern="$1"; shift
  local err="$work_dir/err" out
  if out="$("${aws_cli[@]}" "$@" 2>"$err")"; then
    if [[ "$out" == "None" ]]; then out=""; fi
    printf '%s' "$out"
    return 0
  fi
  if grep -Eq "$pattern" "$err"; then
    return 0
  fi
  cat "$err" >&2
  die "read failed: aws $*"
}

# Splits AWS CLI `--output text` into one value per line, dropping "None".
values() {
  tr '\t' '\n' | grep -v '^None$' | grep -v '^$' || true
}

# Runs a helper, then logs its one-word result under a label. The assignment
# keeps a failure inside the helper fatal, which `log "$(helper)"` would not.
step() {
  local label="$1"; shift
  local result
  result="$("$@")"
  log "$label: $result"
}

# Aborts when a resource the script would create already exists.
check_absent() {
  local kind="$1" pattern="$2"; shift 2
  local result
  result="$(aws_exists "$pattern" "$@")"
  [[ "$result" == "no" ]] ||
    die "refusing to adopt the existing $kind. Choose another --prefix, or remove it if it is a leftover you own."
}

# ---------------------------------------------------------------------------
# Identity and state
# ---------------------------------------------------------------------------
identity="$(aws_run sts get-caller-identity --query '[Account,Arn]' --output text)"
account_id="$(printf '%s' "$identity" | cut -f1)"
partition="$(printf '%s' "$identity" | cut -f2 | cut -d: -f2)"
[[ -n "$account_id" && -n "$partition" ]] || die "could not resolve the caller identity"

thing_name="${prefix}-core"
thing_group_name="${prefix}-group"
role_name="${prefix}-token-exchange"
access_policy_name="${role_name}Access"
access_policy_arn="arn:${partition}:iam::${account_id}:policy/${access_policy_name}"
role_arn="arn:${partition}:iam::${account_id}:role/${role_name}"
role_alias="${prefix}-alias"
device_policy_name="${prefix}-device-policy"
tes_certificate_policy_name="GreengrassTESCertificatePolicy${role_alias}"
thing_group_arn=""; instance_id=""; certificate_arn=""; setup_state="none"
created_group=0; created_thing=0; created_role=0; created_access_policy=0
created_alias=0; created_device_policy=0; created_instance=0

write_state() {
  local tmp="$state_file.tmp.$$"
  umask 077
  cat >"$tmp" <<EOF
# Written by setup-tutorial.sh. Bound to one account, Region and prefix.
export TUTORIAL_ACCOUNT_ID=$(printf '%q' "$account_id")
export TUTORIAL_PARTITION=$(printf '%q' "$partition")
export TUTORIAL_REGION=$(printf '%q' "$region")
export TUTORIAL_PREFIX=$(printf '%q' "$prefix")
export TUTORIAL_SETUP_STATE=$(printf '%q' "$setup_state")
export TUTORIAL_THING_NAME=$(printf '%q' "$thing_name")
export TUTORIAL_THING_GROUP_NAME=$(printf '%q' "$thing_group_name")
export TUTORIAL_THING_GROUP_ARN=$(printf '%q' "$thing_group_arn")
export TUTORIAL_TOKEN_EXCHANGE_ROLE_NAME=$(printf '%q' "$role_name")
export TUTORIAL_TOKEN_EXCHANGE_ROLE_ARN=$(printf '%q' "$role_arn")
export TUTORIAL_ROLE_ALIAS=$(printf '%q' "$role_alias")
export TUTORIAL_DEVICE_POLICY_NAME=$(printf '%q' "$device_policy_name")
export TUTORIAL_INSTANCE_ID=$(printf '%q' "$instance_id")
export TUTORIAL_CERTIFICATE_ARN=$(printf '%q' "$certificate_arn")
export TUTORIAL_MQTT_TOPIC=$(printf '%q' "$MQTT_TOPIC")
export TUTORIAL_CREATED_GROUP=$created_group
export TUTORIAL_CREATED_THING=$created_thing
export TUTORIAL_CREATED_ROLE=$created_role
export TUTORIAL_CREATED_ACCESS_POLICY=$created_access_policy
export TUTORIAL_CREATED_ALIAS=$created_alias
export TUTORIAL_CREATED_DEVICE_POLICY=$created_device_policy
export TUTORIAL_CREATED_INSTANCE=$created_instance
EOF
  mv "$tmp" "$state_file"
}

load_state() {
  [[ -f "$state_file" ]] || die "no state file at $state_file; refusing to guess which resources to touch"
  # shellcheck disable=SC1090
  source "$state_file"
  [[ "${TUTORIAL_ACCOUNT_ID:-}" == "$account_id" &&
    "${TUTORIAL_REGION:-}" == "$region" &&
    "${TUTORIAL_PREFIX:-}" == "$prefix" ]] ||
    die "state file identity mismatch: file has account ${TUTORIAL_ACCOUNT_ID:-?}, Region ${TUTORIAL_REGION:-?}, prefix ${TUTORIAL_PREFIX:-?}; caller is account ${account_id}, Region ${region}, prefix ${prefix}"
  setup_state="${TUTORIAL_SETUP_STATE:-none}"
  thing_name="${TUTORIAL_THING_NAME:-$thing_name}"
  thing_group_name="${TUTORIAL_THING_GROUP_NAME:-$thing_group_name}"
  thing_group_arn="${TUTORIAL_THING_GROUP_ARN:-}"
  role_name="${TUTORIAL_TOKEN_EXCHANGE_ROLE_NAME:-$role_name}"
  role_arn="${TUTORIAL_TOKEN_EXCHANGE_ROLE_ARN:-$role_arn}"
  access_policy_name="${role_name}Access"
  access_policy_arn="arn:${partition}:iam::${account_id}:policy/${access_policy_name}"
  role_alias="${TUTORIAL_ROLE_ALIAS:-$role_alias}"
  tes_certificate_policy_name="GreengrassTESCertificatePolicy${role_alias}"
  device_policy_name="${TUTORIAL_DEVICE_POLICY_NAME:-$device_policy_name}"
  instance_id="${TUTORIAL_INSTANCE_ID:-}"
  certificate_arn="${TUTORIAL_CERTIFICATE_ARN:-}"
  created_group="${TUTORIAL_CREATED_GROUP:-0}"
  created_thing="${TUTORIAL_CREATED_THING:-0}"
  created_role="${TUTORIAL_CREATED_ROLE:-0}"
  created_access_policy="${TUTORIAL_CREATED_ACCESS_POLICY:-0}"
  created_alias="${TUTORIAL_CREATED_ALIAS:-0}"
  created_device_policy="${TUTORIAL_CREATED_DEVICE_POLICY:-0}"
  created_instance="${TUTORIAL_CREATED_INSTANCE:-0}"
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
cleanup() {
  load_state
  log "Cleaning up prefix $prefix in account $account_id, Region $region."

  if [[ "$created_instance" == 1 && -n "$instance_id" ]]; then
    step "Instance $instance_id" aws_delete "$EC2_NOT_FOUND" ec2 terminate-instances --instance-ids "$instance_id"
    local present
    present="$(aws_exists "$EC2_NOT_FOUND" ec2 describe-instances --instance-ids "$instance_id")"
    if [[ "$present" == "yes" ]]; then
      aws_run ec2 wait instance-terminated --instance-ids "$instance_id"
    fi
  fi

  # The installer creates the certificate, so the state file may not know it.
  # The thing is task-owned, so every principal attached to it is too.
  if [[ "$created_thing" == 1 ]]; then
    local principals principal policies policy
    principals="$(aws_read_or_empty "$IOT_NOT_FOUND" iot list-thing-principals --thing-name "$thing_name" --query principals --output text | values)"
    if [[ -z "$principals" && -n "$certificate_arn" ]]; then
      principals="$certificate_arn"
    fi
    while IFS= read -r principal; do
      [[ -n "$principal" ]] || continue
      policies="$(aws_read_or_empty "$IOT_NOT_FOUND" iot list-attached-policies --target "$principal" --query 'policies[].policyName' --output text | values)"
      while IFS= read -r policy; do
        [[ -n "$policy" ]] || continue
        step "Policy $policy on certificate" aws_delete "$IOT_NOT_FOUND" iot detach-policy --policy-name "$policy" --target "$principal"
      done <<<"$policies"
      step "Thing principal" aws_delete "$IOT_NOT_FOUND" iot detach-thing-principal --thing-name "$thing_name" --principal "$principal"
      step "Certificate deactivated" aws_delete "$IOT_NOT_FOUND" iot update-certificate --certificate-id "${principal##*/}" --new-status INACTIVE
      step "Certificate" aws_delete "$IOT_NOT_FOUND" iot delete-certificate --certificate-id "${principal##*/}" --force-delete
    done <<<"$principals"
    step "Group membership" aws_delete "$IOT_NOT_FOUND" iot remove-thing-from-thing-group --thing-group-name "$thing_group_name" --thing-name "$thing_name"
    # The core device record outlives the thing unless deleted explicitly.
    step "Core device record" aws_delete "$IOT_NOT_FOUND" greengrassv2 delete-core-device --core-device-thing-name "$thing_name"
    step "Thing $thing_name" aws_delete "$IOT_NOT_FOUND" iot delete-thing --thing-name "$thing_name"
  fi

  if [[ "$created_group" == 1 ]]; then
    step "Thing group $thing_group_name" aws_delete "$IOT_NOT_FOUND" iot delete-thing-group --thing-group-name "$thing_group_name"
  fi

  # The installer attaches GreengrassTESCertificatePolicy<alias> to the
  # certificate and creates it when missing. The alias name is task-owned, so
  # the policy named after it is too.
  local iot_policy targets target
  for iot_policy in "$device_policy_name" "$tes_certificate_policy_name"; do
    if [[ "$iot_policy" == "$device_policy_name" && "$created_device_policy" != 1 ]]; then continue; fi
    if [[ "$iot_policy" == "$tes_certificate_policy_name" && "$created_alias" != 1 ]]; then continue; fi
    targets="$(aws_read_or_empty "$IOT_NOT_FOUND" iot list-targets-for-policy --policy-name "$iot_policy" --query targets --output text | values)"
    while IFS= read -r target; do
      [[ -n "$target" ]] || continue
      step "Policy $iot_policy target" aws_delete "$IOT_NOT_FOUND" iot detach-policy --policy-name "$iot_policy" --target "$target"
    done <<<"$targets"
    step "IoT policy $iot_policy" aws_delete "$IOT_NOT_FOUND" iot delete-policy --policy-name "$iot_policy"
  done

  if [[ "$created_alias" == 1 ]]; then
    step "Role alias $role_alias" aws_delete "$IOT_NOT_FOUND" iot delete-role-alias --role-alias "$role_alias"
  fi

  if [[ "$created_role" == 1 ]]; then
    # Managed attachments: the access policy this script created, or the one
    # the installer creates when it does not find ours. Inline policies: the
    # CDK read grant, when the stack was not destroyed first.
    local attached arn inline name
    attached="$(aws_read_or_empty "$IAM_NOT_FOUND" iam list-attached-role-policies --role-name "$role_name" --query 'AttachedPolicies[].PolicyArn' --output text | values)"
    while IFS= read -r arn; do
      [[ -n "$arn" ]] || continue
      step "Role attachment $arn" aws_delete "$IAM_NOT_FOUND" iam detach-role-policy --role-name "$role_name" --policy-arn "$arn"
    done <<<"$attached"
    inline="$(aws_read_or_empty "$IAM_NOT_FOUND" iam list-role-policies --role-name "$role_name" --query PolicyNames --output text | values)"
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      step "Inline role policy $name" aws_delete "$IAM_NOT_FOUND" iam delete-role-policy --role-name "$role_name" --policy-name "$name"
    done <<<"$inline"
    step "Role $role_name" aws_delete "$IAM_NOT_FOUND" iam delete-role --role-name "$role_name"
  fi

  if [[ "$created_access_policy" == 1 || "$created_role" == 1 ]]; then
    local versions version
    versions="$(aws_read_or_empty "$IAM_NOT_FOUND" iam list-policy-versions --policy-arn "$access_policy_arn" --query 'Versions[?IsDefaultVersion==`false`].VersionId' --output text | values)"
    while IFS= read -r version; do
      [[ -n "$version" ]] || continue
      step "Access policy version $version" aws_delete "$IAM_NOT_FOUND" iam delete-policy-version --policy-arn "$access_policy_arn" --version-id "$version"
    done <<<"$versions"
    step "Access policy $access_policy_name" aws_delete "$IAM_NOT_FOUND" iam delete-policy --policy-arn "$access_policy_arn"
  fi

  rm -f "$state_file"
  log "Cleanup finished. Deployments, component versions and the artifact bucket belong to your infrastructure project; see the tutorial's cleanup page."
}

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

# Encodes stdin lines as a JSON array of strings, for the SSM parameters file.
json_string_array() {
  local line first=1
  printf '['
  while IFS= read -r line; do
    line="${line//\\/\\\\}"
    line="${line//\"/\\\"}"
    if [[ "$first" == 1 ]]; then first=0; else printf ','; fi
    printf '"%s"' "$line"
  done
  printf ']'
}

setup() {
  if [[ -f "$state_file" ]]; then
    load_state
    if [[ "$setup_state" == "complete" ]]; then
      local state
      state="$(aws_read_or_empty "$EC2_NOT_FOUND" ec2 describe-instances --instance-ids "$instance_id" --query 'Reservations[0].Instances[0].State.Name' --output text)"
      [[ "$state" == "running" || "$state" == "pending" ]] ||
        die "setup already completed but instance $instance_id is ${state:-gone}. Run cleanup, then setup again."
      log "Setup already completed for prefix $prefix; instance $instance_id is $state. Nothing to do."
      log "Run: source $state_file"
      return 0
    fi
    die "a previous setup for prefix $prefix stopped at state '$setup_state'. Run cleanup, then setup again."
  fi

  # The image must be Canonical's Ubuntu 26.04 amd64 server image.
  local image owner architecture name
  image="$(aws_run ec2 describe-images --image-ids "$ami_id" --query 'Images[0].[OwnerId,Architecture,Name]' --output text)"
  owner="$(printf '%s' "$image" | cut -f1)"
  architecture="$(printf '%s' "$image" | cut -f2)"
  name="$(printf '%s' "$image" | cut -f3)"
  [[ "$owner" == "$CANONICAL_OWNER_ID" ]] ||
    die "AMI $ami_id is owned by ${owner:-nobody}, not Canonical ($CANONICAL_OWNER_ID)"
  [[ "$architecture" == "x86_64" ]] ||
    die "AMI $ami_id is ${architecture:-unknown}; the tutorial component targets linux-amd64"
  [[ "$name" == *"$UBUNTU_AMI_NAME_FRAGMENT"* ]] ||
    die "AMI $ami_id is named '$name'; expected an image containing '$UBUNTU_AMI_NAME_FRAGMENT'"

  local profile_present
  profile_present="$(aws_exists "$IAM_NOT_FOUND" iam get-instance-profile --instance-profile-name "$instance_profile")"
  [[ "$profile_present" == "yes" ]] ||
    die "instance profile $instance_profile does not exist in account $account_id"

  # Refuse to adopt anything before creating anything.
  check_absent "thing group $thing_group_name" "$IOT_NOT_FOUND" iot describe-thing-group --thing-group-name "$thing_group_name"
  check_absent "thing $thing_name" "$IOT_NOT_FOUND" iot describe-thing --thing-name "$thing_name"
  check_absent "IAM role $role_name" "$IAM_NOT_FOUND" iam get-role --role-name "$role_name"
  check_absent "IAM policy $access_policy_name" "$IAM_NOT_FOUND" iam get-policy --policy-arn "$access_policy_arn"
  check_absent "role alias $role_alias" "$IOT_NOT_FOUND" iot describe-role-alias --role-alias "$role_alias"
  check_absent "IoT policy $device_policy_name" "$IOT_NOT_FOUND" iot get-policy --policy-name "$device_policy_name"
  check_absent "IoT policy $tes_certificate_policy_name" "$IOT_NOT_FOUND" iot get-policy --policy-name "$tes_certificate_policy_name"

  setup_state="resources"
  thing_group_arn="$(aws_run iot create-thing-group --thing-group-name "$thing_group_name" --query thingGroupArn --output text)"
  created_group=1; write_state
  log "Created thing group $thing_group_name."

  aws_run iot create-thing --thing-name "$thing_name" >/dev/null
  created_thing=1; write_state
  aws_run iot add-thing-to-thing-group --thing-group-name "$thing_group_name" --thing-name "$thing_name"
  log "Created thing $thing_name in $thing_group_name."

  # The token exchange role. Its access policy is the document the nucleus
  # installer would create itself, under the <role>Access name the installer
  # looks for, so the installer reuses it instead of needing iam:CreatePolicy.
  local trust access_document
  trust='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"credentials.iot.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  aws_run iam create-role --role-name "$role_name" --assume-role-policy-document "$trust" \
    --description "Greengrass tutorial token exchange role ($prefix)" >/dev/null
  created_role=1; write_state
  access_document='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents","logs:DescribeLogStreams","s3:GetBucketLocation"],"Resource":"*"}]}'
  aws_run iam create-policy --policy-name "$access_policy_name" --policy-document "$access_document" >/dev/null
  created_access_policy=1; write_state
  aws_run iam attach-role-policy --role-name "$role_name" --policy-arn "$access_policy_arn"
  log "Created role $role_name with $access_policy_name. The artifact read grant is added by your CDK stack."

  # IAM is eventually consistent; the alias creation validates the role.
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if aws_run iot create-role-alias --role-alias "$role_alias" --role-arn "$role_arn" \
      --credential-duration-seconds 3600 >/dev/null 2>"$work_dir/alias-err"; then
      break
    fi
    if [[ "$attempt" == 10 ]]; then
      cat "$work_dir/alias-err" >&2
      die "could not create role alias $role_alias"
    fi
    sleep 5
  done
  created_alias=1; write_state
  log "Created role alias $role_alias."

  # The minimal core device policy from the Greengrass developer guide
  # (Connect, Receive/Publish on the health, jobs and shadow topics, Subscribe
  # on jobs and shadow, AssumeRoleWithCertificate, the four greengrass
  # actions), plus iot:Publish on the tutorial's MQTT topic.
  local iot_arn device_document
  iot_arn="arn:${partition}:iot:${region}:${account_id}"
  device_document=$(cat <<EOF
{"Version":"2012-10-17","Statement":[
{"Effect":"Allow","Action":["iot:Connect"],"Resource":"${iot_arn}:client/${thing_name}*"},
{"Effect":"Allow","Action":["iot:Receive","iot:Publish"],"Resource":[
"${iot_arn}:topic/\$aws/things/${thing_name}/greengrass/health/json",
"${iot_arn}:topic/\$aws/things/${thing_name}/greengrassv2/health/json",
"${iot_arn}:topic/\$aws/things/${thing_name}/jobs/*",
"${iot_arn}:topic/\$aws/things/${thing_name}/shadow/*",
"${iot_arn}:topic/${MQTT_TOPIC}"]},
{"Effect":"Allow","Action":["iot:Subscribe"],"Resource":[
"${iot_arn}:topicfilter/\$aws/things/${thing_name}/jobs/*",
"${iot_arn}:topicfilter/\$aws/things/${thing_name}/shadow/*"]},
{"Effect":"Allow","Action":"iot:AssumeRoleWithCertificate","Resource":"${iot_arn}:rolealias/${role_alias}"},
{"Effect":"Allow","Action":["greengrass:GetComponentVersionArtifact","greengrass:ResolveComponentCandidates","greengrass:GetDeploymentConfiguration","greengrass:ListThingGroupsForCoreDevice"],"Resource":"*"}
]}
EOF
)
  aws_run iot create-policy --policy-name "$device_policy_name" --policy-document "$device_document" >/dev/null
  created_device_policy=1; write_state
  log "Created IoT policy $device_policy_name with iot:Publish on $MQTT_TOPIC."

  # The instance. IMDSv2 only; the nucleus installer reads the instance
  # profile credentials through the AWS SDK default chain. A profile created
  # moments ago can take a few seconds to become usable, hence the retry.
  local run_args
  run_args=(ec2 run-instances --image-id "$ami_id" --instance-type "$instance_type"
    --iam-instance-profile "Name=$instance_profile"
    --metadata-options "HttpTokens=required,HttpEndpoint=enabled"
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${thing_name}},{Key=greengrass-tutorial,Value=${prefix}}]"
    --query 'Instances[0].InstanceId' --output text)
  if [[ -n "$subnet_id" ]]; then
    run_args+=(--subnet-id "$subnet_id")
  fi
  for attempt in 1 2 3 4 5 6; do
    if instance_id="$(aws_run "${run_args[@]}" 2>"$work_dir/run-err")"; then
      break
    fi
    if [[ "$attempt" == 6 ]] || ! grep -q 'Invalid IAM Instance Profile' "$work_dir/run-err"; then
      cat "$work_dir/run-err" >&2
      die "could not launch the instance. Run cleanup to remove the resources created so far."
    fi
    sleep 10
  done
  created_instance=1; setup_state="instance-launched"; write_state
  log "Launched $instance_id ($instance_type). Waiting for it to run and register with Systems Manager."
  aws_run ec2 wait instance-running --instance-ids "$instance_id"

  local ping
  for attempt in $(seq 1 60); do
    ping="$(aws_read_or_empty 'InvalidInstanceId' ssm describe-instance-information \
      --filters "Key=InstanceIds,Values=$instance_id" \
      --query 'InstanceInformationList[0].PingStatus' --output text)"
    if [[ "$ping" == "Online" ]]; then break; fi
    if [[ "$attempt" == 60 ]]; then
      die "$instance_id did not register with Systems Manager within 10 minutes. Check the instance profile and the subnet's outbound access, then run cleanup."
    fi
    sleep 10
  done

  # The remote script. Runs as root under AWS-RunShellScript, which honours the
  # shebang. It contains names only; the installer obtains credentials from the
  # instance profile and creates the device certificate on the instance.
  # On Ubuntu 26.04 the `sudo` package provides /usr/bin/sudo.ws and `sudo-rs`
  # provides the default /usr/bin/sudo alternative; both ship preinstalled, so
  # the install is a no-op and the alternatives switch is the effective step.
  local commands
  commands="$(json_string_array <<EOF
#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
imds_token=\$(curl -sS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
curl -sSf -H "X-aws-ec2-metadata-token: \$imds_token" http://169.254.169.254/latest/meta-data/iam/security-credentials/ >/dev/null
apt-get update -q
apt-get install -y -q openjdk-21-jre-headless unzip python3.14 sudo
update-alternatives --set sudo /usr/bin/sudo.ws
test "\$(readlink -f /usr/bin/sudo)" = /usr/bin/sudo.ws
python3.14 --version
java -version
curl -fsSL -o /tmp/greengrass-nucleus-${NUCLEUS_VERSION}.zip ${NUCLEUS_URL}
rm -rf /tmp/greengrass-installer && mkdir -p /tmp/greengrass-installer
unzip -q /tmp/greengrass-nucleus-${NUCLEUS_VERSION}.zip -d /tmp/greengrass-installer
java -jar /tmp/greengrass-installer/lib/Greengrass.jar --version
java -Droot=/greengrass/v2 -Dlog.store=FILE -jar /tmp/greengrass-installer/lib/Greengrass.jar --aws-region ${region} --thing-name ${thing_name} --thing-group-name ${thing_group_name} --thing-policy-name ${device_policy_name} --tes-role-name ${role_name} --tes-role-alias-name ${role_alias} --component-default-user ggc_user:ggc_group --provision true --setup-system-service true
systemctl is-active greengrass
EOF
)"
  printf '{"commands":%s,"executionTimeout":["1800"]}\n' "$commands" >"$work_dir/parameters.json"

  local command_id status
  setup_state="installing"; write_state
  command_id="$(aws_run ssm send-command --instance-ids "$instance_id" \
    --document-name AWS-RunShellScript \
    --comment "greengrass tutorial nucleus install ($prefix)" \
    --timeout-seconds 600 \
    --parameters "file://$work_dir/parameters.json" \
    --query 'Command.CommandId' --output text)"
  log "Installing the Greengrass nucleus through Systems Manager command $command_id. This takes several minutes."

  # `aws ssm wait command-executed` gives up after about 100 seconds, so poll.
  for attempt in $(seq 1 120); do
    sleep "$POLL_SECONDS"
    status="$(aws_read_or_empty 'InvocationDoesNotExist' ssm get-command-invocation \
      --command-id "$command_id" --instance-id "$instance_id" --query Status --output text)"
    case "$status" in
      Success) break ;;
      ""|Pending|InProgress|Delayed) ;;
      *)
        aws_run ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
          --query '[StandardOutputContent,StandardErrorContent]' --output text | tail -n 40 >&2
        die "the nucleus install command ended with status $status. Run cleanup, fix the cause, then run setup again."
        ;;
    esac
    if [[ "$attempt" == 120 ]]; then
      die "the nucleus install command did not finish within 30 minutes. Run cleanup, then run setup again."
    fi
  done

  # Proof the device exists as the cloud sees it: the certificate the installer
  # attached, and the core device record the nucleus registers on first start.
  certificate_arn="$(aws_read_or_empty "$IOT_NOT_FOUND" iot list-thing-principals --thing-name "$thing_name" --query 'principals[0]' --output text)"
  [[ -n "$certificate_arn" ]] || die "the installer reported success but no certificate is attached to $thing_name. Run cleanup and inspect the instance."
  write_state

  local core_status=""
  for attempt in $(seq 1 20); do
    core_status="$(aws_read_or_empty "$IOT_NOT_FOUND" greengrassv2 get-core-device --core-device-thing-name "$thing_name" --query status --output text)"
    if [[ -n "$core_status" ]]; then break; fi
    sleep "$POLL_SECONDS"
  done
  [[ -n "$core_status" ]] || die "the nucleus did not register $thing_name as a core device within 5 minutes. Run cleanup and inspect /greengrass/v2/logs/greengrass.log on the instance."

  setup_state="complete"; write_state
  log "Core device $thing_name is $core_status on $instance_id."
  log "State written to $state_file. Run: source $state_file"
  log "Then detach the temporary installer permissions from the $instance_profile role."
}

if [[ "$operation" == "cleanup" ]]; then
  cleanup
else
  setup
fi
