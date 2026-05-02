"use client";

import { useParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { CampaignDetailView } from "@/components/campaign-detail-view";

export default function TargetListPage() {
  const params = useParams<{ campaignId: string }>();

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Campaign target list" subtitle="View the target audience for this campaign." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <CampaignDetailView campaignId={params.campaignId} section="target-list" />
      </main>
    </div>
  );
}