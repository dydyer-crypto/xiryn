"use server"

import { eq, notExists } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  agentInputSchema,
  agents,
  squadMembers,
  squads,
  threads,
  type AgentInput,
} from "@/db/schema"
import { stopRun } from "@/lib/agent/runtime"
import { engineSnapshot } from "@/lib/docker"
import { deleteWorkstation } from "@/lib/workstation"

function normalize(values: AgentInput) {
  const data = agentInputSchema.parse(values)
  return {
    ...data,
    instructions: data.instructions?.trim() || null,
    model: data.model?.trim() || null,
  }
}

// A new agent comes with an empty thread to talk to it in
export async function createAgent(values: AgentInput) {
  const data = normalize(values)
  const result = db.transaction((tx) => {
    const [agent] = tx.insert(agents).values(data).returning().all()
    const [thread] = tx
      .insert(threads)
      .values({ agentId: agent.id })
      .returning({ id: threads.id })
      .all()
    return { agent, threadId: thread.id }
  })
  revalidatePath("/", "layout")
  return result
}

export async function updateAgent(agentId: string, values: AgentInput) {
  const data = normalize(values)
  const [agent] = db
    .update(agents)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agents.id, agentId))
    .returning()
    .all()
  if (!agent) throw new Error("Agent not found")
  revalidatePath("/", "layout")
  return agent
}

// Deletes the agent, its threads, its memory — and its workstation
export async function deleteAgent(agentId: string) {
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get()
  if (!agent) throw new Error("Agent not found")

  const owned = db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.agentId, agentId))
    .all()
  for (const thread of owned) stopRun(thread.id)

  // The machine and its files go too. With Docker stopped, the cleanup that
  // runs in the background removes them once it's back.
  if (engineSnapshot()?.state === "ready") await deleteWorkstation(agentId)
  db.delete(agents).where(eq(agents.id, agentId)).run()
  // A squad left with nobody in it has nothing to show
  db.delete(squads)
    .where(
      notExists(db.select().from(squadMembers).where(eq(squadMembers.squadId, squads.id)))
    )
    .run()
  revalidatePath("/", "layout")
}

const agentsImportSchema = z.object({
  agents: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        role: z.string().min(1).max(120),
        instructions: z.string().max(6000).nullish(),
        model: z.string().nullish(),
      })
    )
    .min(1),
})

// Merges agent definitions from a file exported by /api/agents/export. A name
// that already exists is skipped, so importing twice never duplicates agents.
export async function importAgents(raw: string) {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error("That file isn't JSON — pick the file Xiryn exported.")
  }

  const parsed = agentsImportSchema.safeParse(payload)
  if (!parsed.success) throw new Error("No agent definitions found in that file.")

  const existing = new Set(
    db
      .select({ name: agents.name })
      .from(agents)
      .all()
      .map((row) => row.name)
  )

  let created = 0
  let skipped = 0
  let failed = 0

  for (const entry of parsed.data.agents) {
    const name = entry.name.trim()
    if (!name || existing.has(name)) {
      skipped++
      continue
    }
    try {
      // Same validation as the agent dialog, so a hand-edited file can't
      // write something the UI couldn't produce
      const data = normalize({
        name,
        role: entry.role,
        instructions: entry.instructions ?? null,
        model: entry.model ?? null,
      } as AgentInput)
      db.transaction((tx) => {
        const [agent] = tx.insert(agents).values(data).returning().all()
        tx.insert(threads).values({ agentId: agent.id }).run()
      })
      existing.add(name)
      created++
    } catch {
      failed++
    }
  }

  revalidatePath("/", "layout")
  return { created, skipped, failed }
}
