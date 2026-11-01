async function main() {
  const response = await fetch("https://mcp-api.op.gg/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    })
  });

  const text = await response.text();

  console.log("\n===== RAW OP.GG RESPONSE =====\n");
  console.log(text);

  console.log("\n===== MASTERY SEARCH =====\n");

  const lines = text.split("\n");

  const masteryLines = lines.filter(line =>
    /mastery|champion.?points|mastery.?points|mastery.?level/i.test(line)
  );

  if (masteryLines.length) {
    console.log("FOUND POSSIBLE MASTERY FIELDS:\n");

    masteryLines.forEach(line => console.log(line));
  } else {
    console.log("NO MASTERY FIELDS FOUND.");
  }
}

main().catch(console.error);
