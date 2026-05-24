import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const CRAWL4AI_DIR = "/home/ram-dev/projects/crawl4ai";
const PYTHON_CODE = String.raw`
import asyncio
import json
import sys
import urllib.parse
from bs4 import BeautifulSoup
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

payload = json.loads(sys.stdin.read())

browser_config = BrowserConfig(headless=True, verbose=False)

async def crawl(url, wait_for=None, timeout=30000, only_main_content=True):
    delay = (wait_for or 0) / 1000
    if delay > 0:
        await asyncio.sleep(delay)

    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=timeout,
        only_text=bool(only_main_content),
    )

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)

    markdown = str(getattr(result, "markdown", "") or "")
    html = str(getattr(result, "html", "") or "")
    metadata = getattr(result, "metadata", None) or {}

    return {
        "url": getattr(result, "url", url),
        "success": bool(getattr(result, "success", False)),
        "statusCode": getattr(result, "status_code", None),
        "markdown": markdown,
        "html": html,
        "metadata": metadata,
        "error": getattr(result, "error_message", None),
    }


def absolutize(url):
    if url.startswith("//"):
        return "https:" + url
    return url


def parse_duckduckgo(html, limit):
    soup = BeautifulSoup(html, "html.parser")
    rows = []

    for anchor in soup.select("a.result__a, a[data-testid='result-title-a'], a[href]"):
        title = anchor.get_text(" ", strip=True)
        href = anchor.get("href") or ""
        if not title or not href:
            continue

        if "duckduckgo.com/l/?" in href or href.startswith("/l/?"):
            parsed = urllib.parse.urlparse(absolutize(href) if href.startswith("//") else "https://duckduckgo.com" + href if href.startswith("/") else href)
            query = urllib.parse.parse_qs(parsed.query)
            href = query.get("uddg", [href])[0]

        href = absolutize(href)
        if href.startswith("/") or "duckduckgo.com" in href and "uddg=" not in href:
            continue
        if not href.startswith(("http://", "https://")):
            continue
        if any(existing["url"] == href for existing in rows):
            continue

        snippet_node = anchor.find_parent(class_="result")
        snippet = ""
        if snippet_node:
            s = snippet_node.select_one(".result__snippet")
            if s:
                snippet = s.get_text(" ", strip=True)

        rows.append({"title": title, "url": href, "description": snippet})
        if len(rows) >= limit:
            break

    return rows


async def do_scrape():
    params = payload["params"]
    return await crawl(
        params["url"],
        wait_for=params.get("waitFor"),
        timeout=params.get("timeout") or 30000,
        only_main_content=params.get("onlyMainContent", True),
    )


async def do_search():
    params = payload["params"]
    source = params.get("source") or "web"
    if source == "images":
        raise RuntimeError("Crawl4AI local search currently supports web/news results, not image search.")

    limit = max(1, min(int(params.get("limit") or 5), 20))
    query = params["query"]
    ddg_url = "https://duckduckgo.com/html/?q=" + urllib.parse.quote_plus(query)
    if source == "news":
        ddg_url += "&iar=news&ia=news"

    search_doc = await crawl(ddg_url, timeout=30000, only_main_content=False)
    rows = parse_duckduckgo(search_doc.get("html") or "", limit)

    if params.get("scrapeResults"):
        for row in rows:
            try:
                doc = await crawl(row["url"], timeout=30000, only_main_content=True)
                row["markdown"] = (doc.get("markdown") or "").strip()
                row["metadata"] = doc.get("metadata") or {}
                row["statusCode"] = doc.get("statusCode")
            except Exception as exc:
                row["scrapeError"] = str(exc)

    return {"query": query, "source": source, "results": rows, "provider": "crawl4ai", "searchUrl": ddg_url}


async def main():
    if payload["op"] == "scrape":
        result = await do_scrape()
    elif payload["op"] == "search":
        result = await do_search()
    else:
        raise RuntimeError("Unknown op")
    print(json.dumps(result, ensure_ascii=False))

asyncio.run(main())
`;

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runCrawl4AI(op: "search" | "scrape", params: unknown, signal?: AbortSignal) {
  if (!existsSync(CRAWL4AI_DIR)) {
    throw new Error(`Crawl4AI checkout not found: ${CRAWL4AI_DIR}`);
  }

  return await new Promise<any>((resolve, reject) => {
    const child = spawn("uv", ["run", "python", "-c", PYTHON_CODE], {
      cwd: CRAWL4AI_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";

    const abort = () => {
      child.kill("SIGTERM");
      reject(new Error(`${op} cancelled`));
    };

    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${op} failed with exit code ${code}`));
        return;
      }

      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const jsonLine = lines[lines.length - 1];
      try {
        resolve(JSON.parse(jsonLine ?? "{}"));
      } catch {
        reject(new Error(`Could not parse Crawl4AI output. stderr=${stderr.trim()} stdout=${stdout.trim()}`));
      }
    });

    child.stdin.end(JSON.stringify({ op, params }));
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "search",
    label: "Search Web",
    description: "Search the web with local Crawl4AI. Returns web/news results, and can optionally include markdown content for each web result.",
    promptSnippet: "Search the web with local Crawl4AI for current information.",
    promptGuidelines: [
      "Use search when the user asks for current web information, discovery, or sources beyond the local workspace.",
      "Use scrape after search when you need the full markdown content of a specific page.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "The web search query." }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results to return. Defaults to 5.", minimum: 1, maximum: 20 })),
      source: Type.Optional(StringEnum(["web", "news", "images"] as const)),
      scrapeResults: Type.Optional(Type.Boolean({ description: "Whether to scrape result pages and include markdown. Defaults to false." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const searchParams = params as { query: string };
        onUpdate?.({ content: [{ type: "text", text: `Searching with local Crawl4AI: ${searchParams.query}` }], details: {} });
        const result = await runCrawl4AI("search", params, signal);
        return { content: [{ type: "text", text: stringify(result) }], details: result };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Crawl4AI search failed: ${asErrorMessage(error)}` }],
          details: { error: asErrorMessage(error) },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "scrape",
    label: "Scrape Page",
    description: "Grab the content of a single page with local Crawl4AI and return agent-consumable markdown.",
    promptSnippet: "Fetch a URL's page content as markdown with local Crawl4AI.",
    promptGuidelines: [
      "Use scrape when you need the full readable markdown content of a known URL.",
      "Prefer scrape over bash/fetch for web pages because scrape returns cleaned markdown suitable for agent context.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch." }),
      onlyMainContent: Type.Optional(Type.Boolean({ description: "Only return the main page content. Defaults to true." })),
      waitFor: Type.Optional(Type.Number({ description: "Milliseconds to wait before capturing content, useful for JS-heavy pages." })),
      timeout: Type.Optional(Type.Number({ description: "Request timeout in milliseconds. Defaults to 30000." })),
      includeMetadata: Type.Optional(Type.Boolean({ description: "Append page metadata to the markdown output. Defaults to false. Full metadata is always available in details." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const scrapeParams = params as { url: string; includeMetadata?: boolean };
        onUpdate?.({ content: [{ type: "text", text: `Scraping page with local Crawl4AI: ${scrapeParams.url}` }], details: {} });
        const document = await runCrawl4AI("scrape", params, signal);
        const metadata = scrapeParams.includeMetadata && document.metadata ? `\n\nMetadata:\n${stringify(document.metadata)}` : "";
        const markdown = document.markdown?.trim() || "No markdown content returned.";
        return { content: [{ type: "text", text: `${markdown}${metadata}` }], details: document };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Crawl4AI scrape failed: ${asErrorMessage(error)}` }],
          details: { error: asErrorMessage(error) },
          isError: true,
        };
      }
    },
  });
}
