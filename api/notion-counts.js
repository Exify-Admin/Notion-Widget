export default async function handler(req, res) {
  // -------------------------
  // CORS (so Notion embeds / GitHub Pages can call it)
  // -------------------------
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // -------------------------
  // Optional: protect with a shared key (?key=...)
  // Set SHARED_KEY in Vercel env vars to enable
  // -------------------------
  if (process.env.SHARED_KEY) {
    if (req.query.key !== process.env.SHARED_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // -------------------------
  // Cache at Vercel edge
  // -------------------------
  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");

  // -------------------------
  // Env vars
  // -------------------------
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const DATABASE_ID = process.env.DATABASE_ID;
  const STATUS_PROP = process.env.STATUS_PROP || "Status";

  // Your statuses
  const STATUSES = ["Queue", "In Progress", "Past Due", "Blocked", "Completed"];

  if (!NOTION_TOKEN || !DATABASE_ID) {
    return res.status(500).json({ error: "Missing NOTION_TOKEN or DATABASE_ID env vars" });
  }

  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));

  // -------------------------
  // Paginate through database
  // -------------------------
  let start_cursor = undefined;

  try {
    while (true) {
      const notionRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          ...(start_cursor ? { start_cursor } : {})
        }),
      });

      if (!notionRes.ok) {
        const txt = await notionRes.text().catch(() => "");
        return res.status(500).json({
          error: "Notion query failed",
          status: notionRes.status,
          detail: txt
        });
      }

      const data = await notionRes.json();

      for (const page of data.results || []) {
        const prop = page?.properties?.[STATUS_PROP];

        // Works for both Status and Select properties
        const statusName =
          prop?.status?.name ||
          prop?.select?.name ||
          "Unknown";

        if (counts[statusName] !== undefined) counts[statusName] += 1;
      }

      if (!data.has_more) break;
      start_cursor = data.next_cursor;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    return res.status(200).json({
      counts,
      total,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}
