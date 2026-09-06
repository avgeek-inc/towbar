#!/usr/bin/env python3
"""Docker state double: deliberately permits duplicate aliases, like Docker."""
import json
import os
from pathlib import Path
import sys
import time

state = Path(os.environ["ALIAS_TEST_STATE"])
args = sys.argv[1:]
if args[:2] == ["container", "rm"] or args[0] == "rm":
    if args[0] == "container":
        assert len(args) == 3, "Reclamation must not force removal or delete volumes"
    target = state / (args[-1] + ".json")
    if args[0] == "container" and json.loads(target.read_text())["State"]["Running"]:
        raise SystemExit("Cannot remove a running container")
    target.unlink(missing_ok=True)
elif args[0] == "ps":
    for target in state.glob("*.json"):
        if "-aq" in args or json.loads(target.read_text())["State"]["Running"]:
            print(target.stem)
elif args[:2] == ["container", "inspect"]:
    target = state / (args[-1] + ".json")
    if not target.exists():
        sys.exit(1)
    print("[" + target.read_text() + "]")
elif args[0] == "stop":
    target = state / (args[-1] + ".json")
    data = json.loads(target.read_text())
    data["State"].update(Running=False, Status="exited")
    target.write_text(json.dumps(data))
elif args[0] == "run":
    name = args[args.index("--name") + 1]
    (state / (name + ".starting")).touch()
    if os.environ.get("ALIAS_TEST_PAUSE"):
        deadline = time.monotonic() + 10
        while not (state / "continue").exists():
            if time.monotonic() > deadline:
                raise SystemExit("Test did not release Docker startup")
            time.sleep(0.01)
    if os.environ.get("ALIAS_TEST_FAIL"):
        raise SystemExit("Simulated Docker startup failure")
    labels = dict(args[i + 1].split("=", 1) for i, arg in enumerate(args) if arg == "--label")
    network = args[args.index("--network") + 1]
    alias = args[args.index("--network-alias") + 1]
    (state / (name + ".json")).write_text(json.dumps({
        "Name": "/" + name, "Config": {"Labels": labels},
        "State": {"Running": True, "Status": "running", "Restarting": False},
        "NetworkSettings": {"Networks": {network: {"Aliases": [alias]}}},
    }))
    print(name)
elif args[0] == "port":
    print("127.0.0.1:23456")
else:
    raise SystemExit("Unexpected Docker invocation: " + repr(args))
