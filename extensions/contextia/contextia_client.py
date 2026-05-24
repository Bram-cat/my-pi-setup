#!/usr/bin/env python3
import asyncio
import json
import os
import sys
from pathlib import Path

from fastmcp import Client
from fastmcp.client.transports import StdioTransport


def contextia_bin():
    return os.environ.get("PI_CONTEXTIA_BIN", os.path.expanduser("~/.local/bin/contextia"))


def contextia_env():
    env = os.environ.copy()
    env.setdefault("CTX_STORAGE_DIR", f"/var/tmp/.contextia-{os.environ.get('USER', 'user')}")
    env.setdefault("CTX_AUTO_WARM_START", "true")
    env.setdefault("CTX_PERMISSION_LEVEL", "full")
    env.setdefault("CTX_LOG_LEVEL", "ERROR")
    return env


def transport(cwd=None):
    return StdioTransport(
        command=contextia_bin(),
        args=[],
        env=contextia_env(),
        cwd=cwd,
        keep_alive=False,
        log_file=Path(os.devnull),
    )


async def list_tools():
    async with Client(transport()) as client:
        tools = await client.list_tools()
        payload = {
            "tools": [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": tool.inputSchema,
                    "outputSchema": tool.outputSchema,
                }
                for tool in tools
            ]
        }
        print(json.dumps(payload, default=str))


async def call_tool(tool_name, raw_args, cwd=None):
    args = json.loads(raw_args) if raw_args else {}

    async with Client(transport(cwd=cwd)) as client:
        result = await client.call_tool(tool_name, args)
        text_parts = []
        for item in result.content or []:
            if getattr(item, "type", None) == "text":
                text_parts.append(getattr(item, "text", ""))

        payload = {
            "tool": tool_name,
            "text": "\n\n".join(part for part in text_parts if part).strip(),
            "structured": getattr(result, "structured_content", None) or getattr(result, "data", None),
            "isError": bool(getattr(result, "is_error", False)),
        }
        print(json.dumps(payload, default=str))
        if payload["isError"]:
            raise SystemExit(2)


async def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: contextia_client.py list-tools | call <tool> <json-args> [cwd]")

    command = sys.argv[1]

    if command == "list-tools":
        await list_tools()
        return

    if command == "call":
        if len(sys.argv) < 4:
            raise SystemExit("usage: contextia_client.py call <tool> <json-args> [cwd]")
        tool_name = sys.argv[2]
        raw_args = sys.argv[3]
        cwd = sys.argv[4] if len(sys.argv) > 4 else None
        await call_tool(tool_name, raw_args, cwd=cwd)
        return

    raise SystemExit(f"unknown command: {command}")


if __name__ == "__main__":
    asyncio.run(main())
