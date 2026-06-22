"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"

import {
  AutomationBuilder,
  type BuilderInitial,
  type BuilderStep,
} from "@/components/automations/automation-builder"
import { AUTOMATION_TEMPLATES, type TemplateSlug } from "@/lib/automations/templates"
import type { AutomationStepType, AutomationTriggerType } from "@/types"

export default function NewAutomationPage() {
  const params = useSearchParams()
  const template = params.get("template") as TemplateSlug | null

  const initial: BuilderInitial = useMemo(() => {
    const allTemplates = AUTOMATION_TEMPLATES as Record<string, (typeof AUTOMATION_TEMPLATES)[keyof typeof AUTOMATION_TEMPLATES]>
    if (template && allTemplates[template]) {
      const t = allTemplates[template]
      const steps = expandFromSeeds(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        t.steps.map((seed: any, idx: number) => ({
          index: idx,
          step_type: seed.step_type as AutomationStepType,
          step_config: seed.step_config as Record<string, unknown>,
          branch: (seed.branch ?? null) as 'yes' | 'no' | null,
          parent_index: (seed.parent_index ?? null) as number | null,
        })),
      )
      return {
        name: t.name,
        description: t.description,
        trigger_type: t.trigger_type as AutomationTriggerType,
        trigger_config: t.trigger_config as Record<string, unknown>,
        is_active: false,
        steps,
      }
    }
    return {
      name: "",
      description: "",
      trigger_type: "new_message_received" as AutomationTriggerType,
      trigger_config: {},
      is_active: false,
      steps: [],
    }
  }, [template])

  return <AutomationBuilder initial={initial} />
}

interface SeedRow {
  index: number
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branch: "yes" | "no" | null
  parent_index: number | null
}

function uid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

/** Template seeds are flat with parent_index references. Expand into the
 *  builder's nested tree, preserving order within each scope. */
function expandFromSeeds(rows: SeedRow[]): BuilderStep[] {
  const nodes: BuilderStep[] = rows.map((r) => ({
    cid: uid(),
    step_type: r.step_type,
    step_config: r.step_config,
    branches:
      r.step_type === "condition" ? { yes: [], no: [] } : undefined,
  }))
  const roots: BuilderStep[] = []
  rows.forEach((r, i) => {
    if (r.parent_index == null) {
      roots.push(nodes[i])
      return
    }
    const parent = nodes[r.parent_index]
    if (!parent.branches) parent.branches = { yes: [], no: [] }
    parent.branches[r.branch ?? "yes"].push(nodes[i])
  })
  return roots
}
