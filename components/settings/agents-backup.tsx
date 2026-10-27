"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { DownloadIcon, UploadIcon } from "lucide-react"

import { importAgents } from "@/actions/agents"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"

// Agents live only in data/xiryn.db. This gets their definitions out as a
// small JSON file and back in again, so a reinstall or a second machine
// doesn't mean writing them all from scratch.
export function AgentsBackup() {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const file = React.useRef<HTMLInputElement>(null)

  const upload = async (chosen: File) => {
    setPending(true)
    try {
      const result = await importAgents(await chosen.text())
      const parts = [`${result.created} imported`]
      if (result.skipped) parts.push(`${result.skipped} already here`)
      if (result.failed) parts.push(`${result.failed} rejected`)
      toast.add({
        type: "success",
        title: "Agents imported",
        description: parts.join(" · "),
      })
      router.refresh()
    } catch (error) {
      toast.add({
        type: "error",
        title: "Couldn't import agents",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPending(false)
      if (file.current) file.current.value = ""
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-surface/50 p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium">Agents backup</span>
        <span className="text-[12px] leading-relaxed text-muted-foreground">
          Export every agent&apos;s name, role, instructions and model as JSON. Import
          merges them back; a name that already exists is left alone.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href="/api/agents/export" download />}
        >
          <DownloadIcon data-icon="inline-start" />
          Export
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => file.current?.click()}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadIcon data-icon="inline-start" />
          )}
          Import
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            if (chosen) void upload(chosen)
          }}
        />
      </div>
    </div>
  )
}
