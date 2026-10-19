"use client"

import { ActivityIcon, GlobeIcon, MessageSquareIcon, Settings2Icon, SparklesIcon } from "lucide-react"
import { BotStatus } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab, isBusy, View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Activity } from "@/features/activity/components/activity"
import { BotConfig } from "@/features/bot-config/components/bot-config"
import { BrowserSurface } from "@/features/browser/components/browser-surface"
import { Chat } from "@/features/chat/components/chat"
import { BotSkillsTab } from "@/features/skills/components/bot-skills-tab"
import { BotPanelHeader } from "./bot-panel-header"

/** Side panel for one bot: chat, activity, skills, browser and config. */
export function BotPanel({ botId }: { botId: string }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === botId))
  const status = useAppStore((s) => s.statuses[botId]?.status ?? BotStatus.Idle)
  const tab = useAppStore((s) => s.botTab)
  const setTab = useAppStore((s) => s.setBotTab)
  const browserLive = useAppStore((s) => !!s.previews[botId])
  const inFullBrowser = useAppStore((s) => s.view === View.Browser && s.browserBot === botId)

  if (!bot) return null
  const skillCount = bot.skills.length + bot.localSkills.length

  return (
    <div className="flex h-full flex-col bg-background">
      <BotPanelHeader bot={bot} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as BotTab)} className="min-h-0 flex-1 gap-0">
        <div className="overflow-x-auto border-b px-4 py-2">
          <TabsList>
            <TabsTrigger value={BotTab.Chat}><MessageSquareIcon /> Chat</TabsTrigger>
            <TabsTrigger value={BotTab.Activity}><ActivityIcon /> Activity</TabsTrigger>
            <TabsTrigger value={BotTab.Skills}>
              <SparklesIcon /> Skills
              {skillCount > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{skillCount}</span>}
            </TabsTrigger>
            <TabsTrigger value={BotTab.Browser}>
              <GlobeIcon className={cn(browserLive && "text-sky-500")} /> Browser
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
        <TabsContent value={BotTab.Browser} className="flex min-h-0 flex-col">
          {inFullBrowser ? (
            <p className="p-6 text-center text-sm text-muted-foreground">This page is open in the full Browser view.</p>
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
