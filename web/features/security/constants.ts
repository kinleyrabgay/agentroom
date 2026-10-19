import {
  BugIcon,
  CircleAlertIcon,
  FileWarningIcon,
  GlobeIcon,
  InfoIcon,
  KeyRoundIcon,
  LockIcon,
  OctagonAlertIcon,
  PackageIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SpellCheckIcon,
  SyringeIcon,
  TriangleAlertIcon,
  UserCheckIcon,
  type LucideIcon,
} from "lucide-react"
import {
  FindingCategory,
  FindingSeverity,
  FindingSource,
  FindingStatus,
  RiskLevel,
  SecurityReviewMode,
} from "@shared"
import type { Tone } from "@/components/kit/tone"

/** Severity always shows icon + label; color is only a secondary cue. */
export const SEVERITY_META: Record<
  FindingSeverity,
  { label: string; icon: LucideIcon; tone: Tone; stripe: string; text: string; chip: string; rank: number }
> = {
  [FindingSeverity.Critical]: {
    label: "Critical",
    icon: OctagonAlertIcon,
    tone: "danger",
    stripe: "bg-danger",
    text: "text-danger-ink",
    chip: "tone-danger tone-soft",
    rank: 0,
  },
  [FindingSeverity.Warning]: {
    label: "Warning",
    icon: TriangleAlertIcon,
    tone: "warning",
    stripe: "bg-warning",
    text: "text-warning-ink",
    chip: "tone-warning tone-soft",
    rank: 1,
  },
  [FindingSeverity.Info]: {
    label: "Info",
    icon: InfoIcon,
    tone: "neutral",
    stripe: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    chip: "tone-neutral tone-soft",
    rank: 2,
  },
}

export const CATEGORY_META: Record<FindingCategory, { label: string; icon: LucideIcon }> = {
  [FindingCategory.Secret]: { label: "Secret", icon: KeyRoundIcon },
  [FindingCategory.Injection]: { label: "Injection", icon: SyringeIcon },
  [FindingCategory.Crypto]: { label: "Crypto / TLS", icon: LockIcon },
  [FindingCategory.Auth]: { label: "Auth", icon: UserCheckIcon },
  [FindingCategory.Cors]: { label: "CORS", icon: GlobeIcon },
  [FindingCategory.Vulnerability]: { label: "Vulnerable dependency", icon: BugIcon },
  [FindingCategory.Typosquat]: { label: "Typosquat", icon: SpellCheckIcon },
  [FindingCategory.InstallScript]: { label: "Install script", icon: PackageIcon },
  [FindingCategory.PromptInjection]: { label: "Prompt injection", icon: ShieldAlertIcon },
  [FindingCategory.Other]: { label: "Other", icon: FileWarningIcon },
}

export const SOURCE_LABEL: Record<FindingSource, string> = {
  [FindingSource.Scanner]: "Scanner",
  [FindingSource.Dependency]: "Dependency guard",
  [FindingSource.Review]: "Security review",
  [FindingSource.Injection]: "Injection guard",
}

export const STATUS_META: Record<FindingStatus, { label: string; icon: LucideIcon }> = {
  [FindingStatus.Open]: { label: "Open", icon: CircleAlertIcon },
  [FindingStatus.Approved]: { label: "Risk approved", icon: ShieldIcon },
  [FindingStatus.Dismissed]: { label: "Dismissed", icon: ShieldIcon },
  [FindingStatus.Fixed]: { label: "Fixed", icon: ShieldCheckIcon },
}

export const RISK_META: Record<RiskLevel, { label: string; icon: LucideIcon; tone: Tone; chip: string; hint: string }> = {
  [RiskLevel.Low]: {
    label: "Low risk",
    icon: ShieldCheckIcon,
    tone: "success",
    chip: "tone-success tone-soft",
    hint: "No extra gates.",
  },
  [RiskLevel.Medium]: {
    label: "Medium risk",
    icon: ShieldIcon,
    tone: "warning",
    chip: "tone-warning tone-soft",
    hint: "The security review step runs (in Auto mode).",
  },
  [RiskLevel.High]: {
    label: "High risk",
    icon: ShieldAlertIcon,
    tone: "danger",
    chip: "tone-danger tone-soft",
    hint: "Security review runs, and you approve before Test and before the PR.",
  },
}

export const REVIEW_MODE_META: Record<SecurityReviewMode, { label: string; description: string }> = {
  [SecurityReviewMode.Auto]: {
    label: "Auto",
    description: "Runs when risk is medium or higher, or when auth, payment or migration paths change.",
  },
  [SecurityReviewMode.Always]: { label: "Always", description: "The Security Auditor reviews every goal before testing." },
  [SecurityReviewMode.Off]: {
    label: "Off",
    description: "No review step. The scanner and dependency guard still check commits and PRs.",
  },
}

/** What the scanner and guards look for (shown in Settings). */
export const SCANNER_CHECKS: { label: string; detail: string; icon: LucideIcon }[] = [
  { label: "Secrets", detail: "API keys, tokens, private keys, .env contents, hardcoded credentials", icon: KeyRoundIcon },
  { label: "Injection", detail: "eval / new Function, shell and SQL built from strings", icon: SyringeIcon },
  { label: "Crypto & TLS", detail: "Disabled certificate checks, weak hashes", icon: LockIcon },
  { label: "Auth", detail: "Disabled or bypassed auth checks", icon: UserCheckIcon },
  { label: "CORS", detail: "Wide-open origins with credentials", icon: GlobeIcon },
  { label: "Dependencies", detail: "npm audit + OSV, typosquats, packages with install scripts", icon: PackageIcon },
  { label: "Prompt injection", detail: "Instructions hidden in web pages, issues and fetched content", icon: ShieldAlertIcon },
]

/** Marker the server appends to tool output when untrusted content looked like instructions. */
export const INJECTION_MARKER = "⚠ Possible prompt injection detected"
export const ALL = "__all__"
