#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
if args[0] == "info":
    print(os.environ["HOST_LOG_TEST_INFO"])
elif args[:2] == ["volume", "inspect"]:
    if args[-1].startswith("towbar-host-logs-"):
        volume = Path(os.environ["HOST_LOG_TEST_VOLUME"])
        if not volume.exists():
            sys.exit(1)
        print(volume.read_text())
        sys.exit(0)
    print(json.dumps([{"Labels": {
        "towbar.managed": "true", "towbar.storage": "app",
        "towbar.runtime": os.environ["TOWBAR_APP_ID"],
        "towbar.source": os.environ["TOWBAR_SOURCE_ID"],
        "towbar.deployable": os.environ["TOWBAR_DEPLOYABLE_ID"],
    }}]))
elif args[:2] == ["volume", "create"]:
    labels = dict(args[i + 1].split("=", 1) for i, arg in enumerate(args) if arg == "--label")
    options = dict(args[i + 1].split("=", 1) for i, arg in enumerate(args) if arg == "--opt")
    if os.environ.get("HOST_LOG_TEST_FOREIGN"):
        options["device"] = "/etc"
    volume = Path(os.environ["HOST_LOG_TEST_VOLUME"])
    if not volume.exists():
        volume.write_text(json.dumps([{"Driver": "local", "Options": options, "Labels": labels}]))
elif args[:2] == ["volume", "ls"]:
    if Path(os.environ["HOST_LOG_TEST_VOLUME"]).exists():
        print("towbar-host-logs-" + os.environ["TOWBAR_APP_ID"])
elif args[:2] == ["volume", "rm"]:
    Path(os.environ["HOST_LOG_TEST_VOLUME"]).unlink()
elif args[0] == "ps":
    print(os.environ.get("HOST_LOG_TEST_REFERENCES", ""))
elif args[0] == "run":
    Path(os.environ["HOST_LOG_TEST_ARGS"]).write_text(json.dumps(args))
    print("candidate")
elif args[0] == "port":
    print("127.0.0.1:23456")
elif args[0] != "rm":
    raise SystemExit("Unexpected Docker invocation: " + repr(args))
