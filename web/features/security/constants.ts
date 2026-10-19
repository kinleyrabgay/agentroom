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

/** Severity always shows icon + label; color is only a secondary cue. */
export const SEVERITY_META: Record<
  FindingSeverity,
  { label: string; icon: LucideIcon; stripe: string; text: string; chip: string; rank: number }
> = {
  [FindingSeverity.Critical]: {
    label: "Critical",
    icon: OctagonAlertIcon,
    stripe: "bg-red-500",
    text: "text-red-700 dark:text-red-300",
    chip: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    rank: 0,
  },
  [FindingSeverity.Warning]: {
    label: "Warning",
    icon: TriangleAlertIcon,
    stripe: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    rank: 1,
  },
  [FindingSeverity.Info]: {
    label: "Info",
    icon: InfoIcon,
    stripe: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    chip: "border-border bg-muted text-muted-foreground",
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

export const RISK_META: Record<RiskLevel, { label: string; icon: LucideIcon; chip: string; hint: string }> = {
  [RiskLevel.Low]: {
    label: "Low risk",
    icon: ShieldCheckIcon,
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    hint: "No extra gates.",
  },
  [RiskLevel.Medium]: {
    label: "Medium risk",
    icon: ShieldIcon,
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    hint: "The security review step runs (in Auto mode).",
  },
  [RiskLevel.High]: {
    label: "High risk",
    icon: ShieldAlertIcon,
    chip: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
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
