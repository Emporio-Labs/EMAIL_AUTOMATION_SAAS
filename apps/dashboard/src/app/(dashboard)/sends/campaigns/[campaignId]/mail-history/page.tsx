"use client";

import { useParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { CampaignDetailView } from "@/components/campaign-detail-view";

export default function MailHistoryPage() {
  const params = useParams<{ campaignId: string }>();

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Campaign mail history" subtitle="View delivery history for this campaign." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <CampaignDetailView campaignId={params.campaignId} section="mail-history" />
      </main>
    </div>
  );
}