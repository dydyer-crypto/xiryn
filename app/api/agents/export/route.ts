import { db } from "@/db"
import { agents } from "@/db/schema"

export const dynamic = "force-dynamic"

// Agent definitions as a portable JSON file: names, roles, standing orders and
// models. Nothing about threads, memories or the vault leaves the machine.
export function GET() {
  const rows = db
    .select({
      name: agents.name,
      role: agents.role,
      instructions: agents.instructions,
      model: agents.model,
    })
    .from(agents)
    .all()

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    agents: rows,
  }

  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="xiryn-agents-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  })
}
