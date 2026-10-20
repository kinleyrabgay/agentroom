"use client"

import { useEffect, useState } from "react"
import type { ProofAvailability } from "@shared"
import { proofApi } from "@/lib/api/endpoints"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Callout } from "@/components/kit/callout"
import { Segmented } from "@/components/kit/segmented"
import { useSettingsSection } from "../hooks/use-settings-section"
import { SettingsSection } from "../lib/constants"
import { SaveIndicator } from "./save-indicator"
import { SettingsCard } from "./settings-card"

/** Proof of work: whether goals get a Verify step, how the app is started, where the images go. */
export function ProofSection() {
  const { value, update, status } = useSettingsSection("proof")
  const [avail, setAvail] = useState<ProofAvailability | null>(null)
  useEffect(() => {
    proofApi
      .availability()
      .then(setAvail)
      .catch(() => setAvail(null))
  }, [])
  if (!value) return <SettingsCard id={SettingsSection.Proof}>{null}</SettingsCard>
  const off = !value.enabled
  return (
    <SettingsCard id={SettingsSection.Proof} aside={<SaveIndicator status={status} />}>
      <div className="space-y-4">
        {avail && !avail.ok && (
          <Callout tone="info" title="Recording is off on this machine">
            {avail.reason}
          </Callout>
        )}
        <Row id="proof-enabled" label="Verify goals in a browser" hint={`After QA passes, record the feature working and run quality checks.${avail?.ok ? ` Uses ${avail.browser}.` : ""}`}>
          <Switch id="proof-enabled" checked={value.enabled} onCheckedChange={(enabled) => update({ enabled })} />
        </Row>
        <Separator />
        <Row id="proof-publish" label="Images in the PR" hint="Push them to the agentroom/proof branch so the PR shows them, or keep them on this machine (the PR gets the check table only).">
          <Segmented<"branch" | "local">
            aria-label="Where proof images go"
            value={value.publish}
            onChange={(publish) => update({ publish })}
            options={[
              { value: "branch", label: "Proof branch" },
              { value: "local", label: "Keep local" },
            ]}
          />
        </Row>
        <Separator />
        <TextRow id="proof-dev" label="Start the app with" hint="Leave empty to use the dev script from package.json. The port is passed as $PORT (and --port / -p for Vite, Next…)." placeholder="npm run dev" value={value.devCommand} disabled={off} onCommit={(devCommand) => update({ devCommand })} />
        <Separator />
        <TextRow id="proof-url" label="Or use a running app" hint="A URL that's already up (then the starting-commit comparison is skipped)." placeholder="http://localhost:3000" value={value.url} disabled={off} onCommit={(url) => update({ url })} />
        <Separator />
        <Row id="proof-before" label="Compare with the starting commit" hint="Also start the app on the goal's starting commit for before/after shots and new-issue counts.">
          <Switch id="proof-before" checked={value.before} disabled={off} onCheckedChange={(before) => update({ before })} />
        </Row>
        <Separator />
        <NumberRow id="proof-timeout" label="Wait for the app" hint="Seconds to wait for the dev server to answer." value={value.startTimeoutSec} min={10} max={600} disabled={off} onCommit={(startTimeoutSec) => update({ startTimeoutSec })} />
      </div>
    </SettingsCard>
  )
}

/** Quality checks run in the Verify step. */
export function QualitySection() {
  const { value, update, status } = useSettingsSection("quality")
  if (!value) return <SettingsCard id={SettingsSection.Quality}>{null}</SettingsCard>
  return (
    <SettingsCard id={SettingsSection.Quality} aside={<SaveIndicator status={status} />}>
      <div className="space-y-4">
        <Row id="q-gate" label="Pause on a failing check" hint="The goal waits on the Proof tab until you accept or request changes. Off: failures still show and raise the risk score.">
          <Switch id="q-gate" checked={value.gate} onCheckedChange={(gate) => update({ gate })} />
        </Row>
        <Separator />
        <Row id="q-a11y" label="Accessibility" hint="Missing labels, alt text, names and language. Uses axe-core when it's installed, else built-in rules.">
          <Switch id="q-a11y" checked={value.a11y} onCheckedChange={(a11y) => update({ a11y })} />
        </Row>
        <NumberRow id="q-a11y-max" label="New issues allowed" hint="Serious issues the change may add compared with the starting commit." value={value.maxNewA11yIssues} min={0} max={100} disabled={!value.a11y} onCommit={(maxNewA11yIssues) => update({ maxNewA11yIssues })} nested />
        <Separator />
        <Row id="q-perf" label="Performance" hint="Largest paint and layout shift on the dev server. Warns only: dev builds are slow.">
          <Switch id="q-perf" checked={value.perf} onCheckedChange={(perf) => update({ perf })} />
        </Row>
        <NumberRow id="q-lcp" label="Warn above (ms)" hint="Largest Contentful Paint." value={value.maxLcpMs} min={100} max={60000} disabled={!value.perf} onCommit={(maxLcpMs) => update({ maxLcpMs })} nested />
        <Separator />
        <Row id="q-visual" label="Visual change" hint="Pixel difference against the starting commit, per page. Asks for a look; never fails.">
          <Switch id="q-visual" checked={value.visual} onCheckedChange={(visual) => update({ visual })} />
        </Row>
        <NumberRow id="q-visual-max" label="Flag above (%)" hint="Share of pixels that changed." value={value.maxVisualDiffPct} min={0} max={100} disabled={!value.visual} onCommit={(maxVisualDiffPct) => update({ maxVisualDiffPct })} nested />
        <Separator />
        <Row id="q-cov" label="Coverage" hint="Runs your coverage command on the goal and on the starting commit.">
          <Switch id="q-cov" checked={value.coverage} onCheckedChange={(coverage) => update({ coverage })} />
        </Row>
        <TextRow id="q-cov-cmd" label="Coverage command" hint="Must write coverage/coverage-summary.json or coverage/lcov.info." placeholder="npx vitest run --coverage" value={value.coverageCommand} disabled={!value.coverage} onCommit={(coverageCommand) => update({ coverageCommand })} nested />
        <NumberRow id="q-cov-drop" label="Allowed drop (points)" hint="Line coverage may fall by at most this much." value={value.maxCoverageDrop} min={0} max={100} step={0.5} disabled={!value.coverage} onCommit={(maxCoverageDrop) => update({ maxCoverageDrop })} nested />
        <Separator />
        <Row id="q-bundle" label="Bundle size" hint="Builds both sides and compares the JS and CSS output.">
          <Switch id="q-bundle" checked={value.bundle} onCheckedChange={(bundle) => update({ bundle })} />
        </Row>
        <TextRow id="q-build" label="Build command" hint="Runs in the goal's folder and on the starting commit." placeholder="npm run build" value={value.buildCommand} disabled={!value.bundle} onCommit={(buildCommand) => update({ buildCommand })} nested />
        <TextRow id="q-out" label="Output folder" hint="Leave empty to detect (.next/static, dist, build, out)." placeholder="dist" value={value.bundleDir} disabled={!value.bundle} onCommit={(bundleDir) => update({ bundleDir })} nested />
        <NumberRow id="q-growth" label="Allowed growth (%)" hint="Fail when the output grows more than this." value={value.maxBundleGrowthPct} min={0} max={1000} disabled={!value.bundle} onCommit={(maxBundleGrowthPct) => update({ maxBundleGrowthPct })} nested />
        <Separator />
        <Row id="q-design" label="Design match" hint="Implement design goals: render the page at the frame's size and score it against the Figma frame or design image.">
          <Switch id="q-design" checked={value.design} onCheckedChange={(design) => update({ design })} />
        </Row>
        <NumberRow id="q-design-min" label="Fail below (score)" hint="0–100: structure, pixels and proportions combined." value={value.minDesignMatch} min={0} max={100} disabled={!value.design} onCommit={(minDesignMatch) => update({ minDesignMatch })} nested />
      </div>
    </SettingsCard>
  )
}

/** Incident autopilot: whether a fix may open its PR without you, and how sure it must be. */
export function AutopilotSettingsSection() {
  const { value, update, status } = useSettingsSection("autopilot")
  if (!value) return <SettingsCard id={SettingsSection.Autopilot}>{null}</SettingsCard>
  return (
    <SettingsCard id={SettingsSection.Autopilot} aside={<SaveIndicator status={status} />}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Add a Sentry trigger with <span className="font-medium text-foreground">run autopilot</span> (Automation), or press Run autopilot on an issue. The team reproduces the error and writes a
          failing test; AgentRoom checks it fails before and passes after the fix, then scores its confidence.
        </p>
        <Row id="ap-auto" label="Allow PRs without me" hint="Off: every autopilot fix waits for you to review and open the PR. On: triggers set to “open the PR when confident” may open it on their own.">
          <Switch id="ap-auto" checked={value.allowAutoPr} onCheckedChange={(allowAutoPr) => update({ allowAutoPr })} />
        </Row>
        <NumberRow id="ap-min" label="Minimum confidence" hint="A fix needs at least this score (0–100) and a test verified fail → pass." value={value.minConfidence} min={0} max={100} disabled={!value.allowAutoPr} onCommit={(minConfidence) => update({ minConfidence })} nested />
        {value.allowAutoPr && (
          <Callout tone="warning" title="PRs can open while you're away">
            Only from triggers you set to open the PR when confident, and only after the failing test is verified on both commits. Every auto-opened PR is in the Audit log.
          </Callout>
        )}
      </div>
    </SettingsCard>
  )
}

function Row({ id, label, hint, nested, children }: { id: string; label: string; hint: string; nested?: boolean; children: React.ReactNode }) {
  return (
    <div className={nested ? "flex flex-wrap items-center gap-3 pl-4" : "flex flex-wrap items-center gap-3"}>
      <div className="min-w-48 flex-1">
        <Label htmlFor={id} className={nested ? "text-sm" : "text-sm font-medium"}>
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

/** A text setting saved on blur/Enter. */
function TextRow({ id, label, hint, placeholder, value, disabled, nested, onCommit }: { id: string; label: string; hint: string; placeholder: string; value: string; disabled?: boolean; nested?: boolean; onCommit: (v: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null)
  const commit = () => {
    if (typed !== null && typed.trim() !== value) onCommit(typed.trim())
    setTyped(null)
  }
  return (
    <Row id={id} label={label} hint={hint} nested={nested}>
      <Input
        id={id}
        value={typed ?? value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-full font-mono text-xs sm:w-64"
      />
    </Row>
  )
}

/** A number setting saved on blur/Enter; out-of-range input is marked and not saved. */
function NumberRow({ id, label, hint, value, min, max, step = 1, disabled, nested, onCommit }: { id: string; label: string; hint: string; value: number; min: number; max: number; step?: number; disabled?: boolean; nested?: boolean; onCommit: (v: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null)
  const text = typed ?? String(value)
  const n = Number(text)
  const valid = text.trim() !== "" && Number.isFinite(n) && n >= min && n <= max && (step >= 1 ? Number.isInteger(n) : true)
  const commit = () => {
    if (typed !== null && valid && n !== value) onCommit(n)
    setTyped(null)
  }
  return (
    <Row id={id} label={label} hint={hint} nested={nested}>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-invalid={!valid}
        className="w-24 text-right tabular-nums"
      />
    </Row>
  )
}
