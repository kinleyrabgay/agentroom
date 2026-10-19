"use client"

import { ActivityIcon, AppWindowIcon, BrainIcon, GlobeIcon, MessageSquareIcon, Settings2Icon, SparklesIcon } from "lucide-react"
import { BotStatus } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab, isBusy, View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ToneDot } from "@/components/kit/badge"
import { EmptyState } from "@/components/kit/state-view"
import { Activity } from "@/features/activity/components/activity"
import { BotConfig } from "@/features/bot-config/components/bot-config"
import { BrowserSurface } from "@/features/browser/components/browser-surface"
import { Chat } from "@/features/chat/components/chat"
import { BotSkillsTab } from "@/features/skills/components/bot-skills-tab"
import { MemoryTab, MemoryTabLabel } from "@/features/memory/components/memory-tab"
import { BotPanelHeader } from "./bot-panel-header"

/** Side panel for one bot: chat, activity, skills, browser and config. */
export function BotPanel({ botId }: { botId: string }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === botId))
  const status = useAppStore((s) => s.statuses[botId]?.status ?? BotStatus.Idle)
  const tab = useAppStore((s) => s.botTab)
  const setTab = useAppStore((s) => s.setBotTab)
  const browserLive = useAppStore((s) => !!s.previews[botId])
  const inFullBrowser = useAppStore((s) => s.view === View.Browser && s.browserBot === botId)
  const setView = useAppStore((s) => s.setView)

  if (!bot) return null
  const skillCount = bot.skills.length + bot.localSkills.length

  return (
    <div className="flex h-full flex-col bg-background">
      <BotPanelHeader bot={bot} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as BotTab)} className="min-h-0 flex-1 gap-0">
        <div className="overflow-x-auto border-b px-3">
          <TabsList variant="line" className="h-10">
            <TabsTrigger value={BotTab.Chat}><MessageSquareIcon /> Chat</TabsTrigger>
            <TabsTrigger value={BotTab.Activity}><ActivityIcon /> Activity</TabsTrigger>
            <TabsTrigger value={BotTab.Skills}>
              <SparklesIcon /> Skills
              {skillCount > 0 && <span className="text-xs text-muted-foreground tabular-nums">{skillCount}</span>}
            </TabsTrigger>
            <TabsTrigger value={BotTab.Memory}>
              <BrainIcon /> Memory <MemoryTabLabel botId={bot.id} />
            </TabsTrigger>
            <TabsTrigger value={BotTab.Browser}>
              <GlobeIcon className={cn(browserLive && "text-info")} /> Browser
              {browserLive && <ToneDot tone="info" pulse className="size-1.5" />}
            </TabsTrigger>
            <TabsTrigger value={BotTab.Config}><Settings2Icon /> Config</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value={BotTab.Chat} className="flex min-h-0 flex-col">
          <Chat bot={bot} running={isBusy(status)} />
        </TabsContent>
        <TabsContent value={BotTab.Activity} className="min-h-0">
          <Activity botId={bot.id} />
        </TabsContent>
        <TabsContent value={BotTab.Skills} className="min-h-0">
          <BotSkillsTab bot={bot} />
        </TabsContent>
        <TabsContent value={BotTab.Memory} className="min-h-0">
          <MemoryTab key={bot.id} bot={bot} />
        </TabsContent>
        <TabsContent value={BotTab.Browser} className="flex min-h-0 flex-col">
          {inFullBrowser ? (
            <EmptyState
              compact
              icon={AppWindowIcon}
              title="Open in the Browser view"
              description={`${bot.name}'s page is showing in the full Browser. One page can't be in two places.`}
              action={
                <Button size="sm" variant="outline" onClick={() => setView(View.Browser)}>
                  Go to Browser
                </Button>
              }
            />
          ) : (
            <BrowserSurface bot={bot} compact />
          )}
        </TabsContent>
        <TabsContent value={BotTab.Config} className="min-h-0">
          <BotConfig key={bot.id} bot={bot} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
