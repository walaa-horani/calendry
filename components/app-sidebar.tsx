"use client"

import * as React from "react"
import {
  AudioWaveform,
  Calendar,
  Command,
  Contact,
  Frame,
  GalleryVerticalEnd,
  LayoutDashboard,
  Map,
  PieChart,
  Settings2,
  Workflow,
  Plus,
  Users,
  Search,
  ChevronRight,
  MoreHorizontal,
  PlusCircle,
  HelpCircle,
  BarChart3,
  Settings,
  Route,
  ArrowUpCircle,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import Link from "next/link"

// This is the data for the sidebar based on the image
const data = {
  user: {
    name: "Walaa Morani",
    email: "walaa@example.com",
    avatar: "/avatars/walaa.jpg",
  },
  navMain: [
    {
      title: "Scheduling",
      url: "/scheduling",
      icon: Calendar,
      isActive: true,
      items: [
        { title: "Event types", url: "/scheduling/event-types" },
        { title: "Single-use links", url: "/scheduling/single-use-links" },
        { title: "Meeting polls", url: "/scheduling/meeting-polls" },
      ],
    },
    {
      title: "Meetings",
      url: "#",
      icon: Users,
    },
    {
      title: "Availability",
      url: "/availability",
      icon: AudioWaveform,
    },
    {
      title: "Contacts",
      url: "#",
      icon: Contact,
    },
    {
      title: "Workflows",
      url: "#",
      icon: Workflow,
    },
    {
      title: "Integrations & apps",
      url: "#",
      icon: GalleryVerticalEnd,
    },
    {
      title: "Routing",
      url: "#",
      icon: Route,
    },
  ],
  secondary: [
    {
      title: "Upgrade plan",
      url: "#",
      icon: ArrowUpCircle,
      className: "text-blue-600 font-medium",
    },
    {
      title: "Analytics",
      url: "#",
      icon: BarChart3,
    },
    {
      title: "Admin center",
      url: "#",
      icon: Settings,
    },
    {
      title: "Help",
      url: "#",
      icon: HelpCircle,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props} className="border-r border-border/50">
      <SidebarHeader className="h-16 flex items-center px-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="hover:bg-transparent">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-blue-600 text-sidebar-primary-foreground">
                <Calendar className="size-5" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-bold text-xl tracking-tight text-blue-600">Calendly</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <div className="px-4 py-2">
          <Button className="w-full justify-start gap-2 rounded-full h-10 px-4 bg-white border border-border text-foreground hover:bg-slate-50 transition-colors shadow-sm">
            <Plus className="h-4 w-4" />
            <span className="font-medium">Create</span>
          </Button>
        </div>

        <SidebarGroup>
          <SidebarMenu>
            {data.navMain.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  render={<Link href={item.url} />}
                  tooltip={item.title}
                  isActive={item.isActive}
                  className={`gap-3 py-2.5 h-auto ${item.isActive ? 'bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700 font-medium' : ''}`}
                >
                  {item.icon && <item.icon className={`size-5 ${item.isActive ? 'text-blue-700' : 'text-slate-500'}`} />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="mt-auto border-t border-border/50">
          <SidebarMenu>
            {data.secondary.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  render={<Link href={item.url} />}
                  tooltip={item.title}
                  className={`gap-3 py-2.5 h-auto ${item.className || ''}`}
                >
                  {item.icon && <item.icon className="size-5" />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/50">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger >
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-full">
                    <AvatarImage src={data.user.avatar} alt={data.user.name} />
                    <AvatarFallback className="rounded-full bg-blue-100 text-blue-700 font-bold">WM</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight ml-2">
                    <span className="truncate font-semibold">{data.user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{data.user.email}</span>
                  </div>
                  <MoreHorizontal className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-full">
                      <AvatarImage src={data.user.avatar} alt={data.user.name} />
                      <AvatarFallback className="rounded-full">WM</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{data.user.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{data.user.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  Account settings
                </DropdownMenuItem>
                <DropdownMenuItem>
                  Organization settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
