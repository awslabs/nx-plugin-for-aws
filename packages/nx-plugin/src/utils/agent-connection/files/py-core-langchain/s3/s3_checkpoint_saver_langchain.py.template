"""Async S3 checkpoint storage for LangGraph, backed by a plain (sync) boto3 client."""

from __future__ import annotations

import base64
import builtins
import json
import logging
from collections.abc import AsyncIterator, Iterator, Sequence
from typing import Any, cast

import boto3
from botocore.exceptions import ClientError
from langchain_core.runnables import RunnableConfig, run_in_executor
from langgraph.checkpoint.base import (
    WRITES_IDX_MAP,
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
    get_checkpoint_id,
    get_checkpoint_metadata,
)
from langgraph.checkpoint.serde.base import SerializerProtocol

logger = logging.getLogger(__name__)


def _normalize_checkpoint_ns(checkpoint_ns: str) -> str:
    return checkpoint_ns if checkpoint_ns else "__default__"


def _denormalize_checkpoint_ns(checkpoint_ns_safe: str) -> str:
    return "" if checkpoint_ns_safe == "__default__" else checkpoint_ns_safe


def _get_checkpoint_key(prefix: str, thread_id: str, checkpoint_ns: str, checkpoint_id: str) -> str:
    checkpoint_ns_safe = _normalize_checkpoint_ns(checkpoint_ns)
    return f"{prefix}checkpoints/{thread_id}/{checkpoint_ns_safe}/{checkpoint_id}.json"


def _get_writes_prefix(prefix: str, thread_id: str, checkpoint_ns: str, checkpoint_id: str) -> str:
    checkpoint_ns_safe = _normalize_checkpoint_ns(checkpoint_ns)
    return f"{prefix}writes/{thread_id}/{checkpoint_ns_safe}/{checkpoint_id}/"


def _get_write_key(prefix: str, thread_id: str, checkpoint_ns: str, checkpoint_id: str, task_id: str, idx: int) -> str:
    return f"{_get_writes_prefix(prefix, thread_id, checkpoint_ns, checkpoint_id)}{task_id}_{idx}.json"


def _serialize_checkpoint_data(checkpoint: Checkpoint, metadata: CheckpointMetadata, serde: SerializerProtocol) -> str:
    checkpoint_type, serialized_checkpoint = serde.dumps_typed(checkpoint)
    checkpoint_b64 = base64.b64encode(serialized_checkpoint).decode("utf-8")
    metadata_type, serialized_metadata = serde.dumps_typed(metadata)
    metadata_b64 = base64.b64encode(serialized_metadata).decode("utf-8")
    return json.dumps(
        {
            "checkpoint_type": checkpoint_type,
            "checkpoint": checkpoint_b64,
            "metadata_type": metadata_type,
            "metadata": metadata_b64,
        },
        indent=2,
    )


def _deserialize_checkpoint_data(data: str, serde: SerializerProtocol) -> tuple[Checkpoint, CheckpointMetadata]:
    parsed = json.loads(data)
    checkpoint = serde.loads_typed((parsed["checkpoint_type"], base64.b64decode(parsed["checkpoint"])))
    metadata = cast(
        CheckpointMetadata,
        serde.loads_typed((parsed["metadata_type"], base64.b64decode(parsed["metadata"]))),
    )
    return checkpoint, metadata


def _serialize_write_data(channel: str, value: Any, serde: SerializerProtocol) -> str:
    type_, serialized_value = serde.dumps_typed(value)
    value_b64 = base64.b64encode(serialized_value).decode("utf-8")
    return json.dumps({"channel": channel, "value_type": type_, "value": value_b64}, indent=2)


def _deserialize_write_data(data: str, serde: SerializerProtocol) -> tuple[str, Any]:
    parsed = json.loads(data)
    value = serde.loads_typed((parsed["value_type"], base64.b64decode(parsed["value"])))
    return parsed["channel"], value


class S3CheckpointSaver(BaseCheckpointSaver[str]):
    """A checkpoint saver that stores LangGraph checkpoints in Amazon S3.

    The sync methods (`get_tuple`, `list`, `put`, `put_writes`,
    `delete_thread`) call boto3 directly. The async methods offload the same
    sync methods to a thread via `run_in_executor` (mirroring
    `langgraph_checkpoint_aws`'s `DynamoDBSaver`), since graphs compiled with
    this checkpointer are invoked via `.ainvoke()`/`.astream()`.
    """

    def __init__(
        self,
        bucket_name: str,
        *,
        prefix: str = "checkpoints/",
        s3_client: Any | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.bucket_name = bucket_name
        self.prefix = prefix.rstrip("/") + "/" if prefix else ""
        self.s3_client = s3_client or boto3.client("s3")

    def get_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        thread_id = str(config["configurable"]["thread_id"])
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")

        if checkpoint_id := get_checkpoint_id(config):
            key = _get_checkpoint_key(self.prefix, thread_id, checkpoint_ns, checkpoint_id)
            try:
                response = self.s3_client.get_object(Bucket=self.bucket_name, Key=key)
                checkpoint_data = response["Body"].read().decode("utf-8")
                checkpoint, metadata = _deserialize_checkpoint_data(checkpoint_data, self.serde)

                pending_writes = self._get_writes(thread_id, checkpoint_ns, checkpoint_id)

                parent_config = None
                if "parents" in metadata and checkpoint_ns in metadata["parents"]:
                    parent_config = RunnableConfig(
                        configurable={
                            "thread_id": thread_id,
                            "checkpoint_ns": checkpoint_ns,
                            "checkpoint_id": metadata["parents"][checkpoint_ns],
                        }
                    )

                return CheckpointTuple(
                    config=config,
                    checkpoint=checkpoint,
                    metadata=metadata,
                    parent_config=parent_config,
                    pending_writes=pending_writes,
                )
            except ClientError as e:
                if e.response["Error"]["Code"] == "NoSuchKey":
                    return None
                raise RuntimeError(f"Failed to get checkpoint: {e}") from e

        checkpoint_ns_safe = _normalize_checkpoint_ns(checkpoint_ns)
        prefix = f"{self.prefix}checkpoints/{thread_id}/{checkpoint_ns_safe}/"
        try:
            paginator = self.s3_client.get_paginator("list_objects_v2")
            objects = [
                obj
                for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix)
                for obj in page.get("Contents", [])
            ]
            if not objects:
                return None
            latest_key = sorted(objects, key=lambda x: x["Key"], reverse=True)[0]["Key"]
            latest_checkpoint_id = latest_key.split("/")[-1].replace(".json", "")
            return self.get_tuple(
                RunnableConfig(
                    configurable={
                        "thread_id": thread_id,
                        "checkpoint_ns": checkpoint_ns,
                        "checkpoint_id": latest_checkpoint_id,
                    }
                )
            )
        except ClientError as e:
            raise RuntimeError(f"Failed to list checkpoints: {e}") from e

    # `builtins.list` is used here (rather than the bare `list` type) because this class
    # defines its own `list` method below, which shadows the builtin for annotations
    # resolved within this class body.
    def _get_writes(
        self, thread_id: str, checkpoint_ns: str, checkpoint_id: str
    ) -> builtins.list[tuple[str, str, Any]]:
        writes_prefix = _get_writes_prefix(self.prefix, thread_id, checkpoint_ns, checkpoint_id)
        writes = []
        paginator = self.s3_client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket_name, Prefix=writes_prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                filename = key.split("/")[-1].replace(".json", "")
                if "_" not in filename:
                    continue
                task_id, idx_str = filename.rsplit("_", 1)
                try:
                    idx = int(idx_str)
                except ValueError:
                    continue
                response = self.s3_client.get_object(Bucket=self.bucket_name, Key=key)
                channel, value = _deserialize_write_data(response["Body"].read().decode("utf-8"), self.serde)
                writes.append((task_id, channel, value, idx))

        writes.sort(key=lambda x: (x[0], x[3]))
        return [(task_id, channel, value) for task_id, channel, value, _ in writes]

    def list(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        if config is None:
            prefix = f"{self.prefix}checkpoints/"
        else:
            thread_id = str(config["configurable"]["thread_id"])
            checkpoint_ns_safe = _normalize_checkpoint_ns(config["configurable"].get("checkpoint_ns", ""))
            prefix = f"{self.prefix}checkpoints/{thread_id}/{checkpoint_ns_safe}/"

        before_checkpoint_id = get_checkpoint_id(before) if before else None

        try:
            paginator = self.s3_client.get_paginator("list_objects_v2")
            checkpoints = []
            for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
                for obj in page.get("Contents", []):
                    key = obj["Key"]
                    if not key.endswith(".json"):
                        continue
                    parts = key[len(self.prefix) :].split("/")
                    if len(parts) < 4 or parts[0] != "checkpoints":
                        continue
                    key_checkpoint_id = parts[3].replace(".json", "")
                    if before_checkpoint_id and key_checkpoint_id >= before_checkpoint_id:
                        continue
                    checkpoints.append((parts[1], _denormalize_checkpoint_ns(parts[2]), key_checkpoint_id))

            checkpoints.sort(key=lambda x: x[2], reverse=True)
            if limit:
                checkpoints = checkpoints[:limit]

            for thread_id, checkpoint_ns, checkpoint_id in checkpoints:
                checkpoint_tuple = self.get_tuple(
                    RunnableConfig(
                        configurable={
                            "thread_id": thread_id,
                            "checkpoint_ns": checkpoint_ns,
                            "checkpoint_id": checkpoint_id,
                        }
                    )
                )
                if checkpoint_tuple and (
                    not filter or all(checkpoint_tuple.metadata.get(k) == v for k, v in filter.items())
                ):
                    yield checkpoint_tuple
        except ClientError as e:
            raise RuntimeError(f"Failed to list checkpoints: {e}") from e

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        thread_id = str(config["configurable"]["thread_id"])
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = checkpoint["id"]

        full_metadata = get_checkpoint_metadata(config, metadata)
        checkpoint_data = _serialize_checkpoint_data(checkpoint, full_metadata, self.serde)
        key = _get_checkpoint_key(self.prefix, thread_id, checkpoint_ns, checkpoint_id)

        try:
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=checkpoint_data,
                ContentType="application/json",
            )
            return {
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_ns": checkpoint_ns,
                    "checkpoint_id": checkpoint_id,
                }
            }
        except ClientError as e:
            raise RuntimeError(f"Failed to save checkpoint: {e}") from e

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        thread_id = str(config["configurable"]["thread_id"])
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = str(config["configurable"]["checkpoint_id"])

        try:
            for idx, (channel, value) in enumerate(writes):
                write_idx = WRITES_IDX_MAP.get(channel, idx)
                write_data = _serialize_write_data(channel, value, self.serde)
                key = _get_write_key(self.prefix, thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx)
                self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=key,
                    Body=write_data,
                    ContentType="application/json",
                )
        except ClientError as e:
            raise RuntimeError(f"Failed to store writes: {e}") from e

    def delete_thread(self, thread_id: str) -> None:
        thread_id = str(thread_id)
        prefixes = [
            f"{self.prefix}checkpoints/{thread_id}/",
            f"{self.prefix}writes/{thread_id}/",
        ]
        deleted_count = 0
        try:
            for prefix in prefixes:
                paginator = self.s3_client.get_paginator("list_objects_v2")
                objects_to_delete = []
                for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
                    for obj in page.get("Contents", []):
                        objects_to_delete.append({"Key": obj["Key"]})
                        if len(objects_to_delete) >= 1000:
                            self.s3_client.delete_objects(
                                Bucket=self.bucket_name, Delete={"Objects": objects_to_delete}
                            )
                            deleted_count += len(objects_to_delete)
                            objects_to_delete = []
                if objects_to_delete:
                    self.s3_client.delete_objects(Bucket=self.bucket_name, Delete={"Objects": objects_to_delete})
                    deleted_count += len(objects_to_delete)
        except ClientError as e:
            raise RuntimeError(f"Failed to delete thread data: {e}") from e

        if deleted_count == 0:
            logger.info("No checkpoints found for thread_id=%s", thread_id)
        else:
            logger.info("Deleted %d objects for thread_id=%s", deleted_count, thread_id)

    async def aget_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        return await run_in_executor(None, self.get_tuple, config)

    async def alist(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        # ``list`` is backed by blocking boto3 calls, so it is driven from a
        # background thread one item at a time to avoid blocking the event loop
        # while still yielding lazily (no need to materialize all results).
        iterator = self.list(config, filter=filter, before=before, limit=limit)

        def next_item() -> CheckpointTuple | None:
            return next(iterator, None)

        while (item := await run_in_executor(None, next_item)) is not None:
            yield item

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        return await run_in_executor(None, self.put, config, checkpoint, metadata, new_versions)

    async def aput_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        await run_in_executor(None, self.put_writes, config, writes, task_id, task_path)

    async def adelete_thread(self, thread_id: str) -> None:
        await run_in_executor(None, self.delete_thread, thread_id)
