# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Drives the generated FastAPI container entry point and reports what it published.

Powertools writes each metric set to stdout as one embedded-metric-format
document, so the check is to capture stdout around a request and read the
documents back. Run as:

    python run_checks.py <project root> <module package>

and it prints one `RESULTS <json>` line.
"""

import contextlib
import io
import json
import sys


def emf_documents(output: str) -> list[dict]:
    """Every embedded-metric-format document in captured stdout."""
    documents = []
    for line in output.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "_aws" in parsed:
            documents.append(parsed)
    return documents


def summarise(document: dict) -> dict:
    """The parts of a document the test asserts on."""
    metric_names = [
        metric["Name"]
        for directive in document["_aws"]["CloudWatchMetrics"]
        for metric in directive["Metrics"]
    ]
    dimensions = {
        name: document.get(name)
        for directive in document["_aws"]["CloudWatchMetrics"]
        for names in directive["Dimensions"]
        for name in names
    }
    return {"metrics": sorted(metric_names), "dimensions": dimensions}


def request(client, method: str, path: str, **kwargs) -> dict:
    """Makes one request and returns its status and what it published."""
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        response = client.request(method, path, **kwargs)
    output = captured.getvalue()
    return {
        "status": response.status_code,
        "documents": [summarise(d) for d in emf_documents(output)],
        "warnings": [
            line
            for line in output.splitlines()
            if "PowertoolsUserWarning" in line or "has already been added" in line
        ],
    }


def main() -> None:
    project_root, module_package = sys.argv[1], sys.argv[2]
    sys.path.insert(0, project_root)

    from fastapi.testclient import TestClient

    container_main = __import__(
        f"{module_package}.main", fromlist=["app", "HEALTH_CHECK_PATH"]
    )
    client = TestClient(container_main.app)

    results = {
        # The load balancer's target group calls this every 15 seconds.
        "health": request(
            client, "GET", getattr(container_main, "HEALTH_CHECK_PATH", "/health")
        ),
        # A real API request.
        "echo": request(client, "GET", "/echo", params={"message": "test"}),
        # And a second one, to show the route dimension is not accumulated.
        "echo_again": request(client, "GET", "/echo", params={"message": "test"}),
        # A request to a route that does not exist still counts as a request.
        "missing": request(client, "GET", "/not-a-route"),
    }
    print(f"RESULTS {json.dumps(results)}")


if __name__ == "__main__":
    main()
