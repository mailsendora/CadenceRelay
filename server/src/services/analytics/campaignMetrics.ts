export interface CampaignMetricCounts {
  sent: number; delivered: number; bounced: number; complained: number; opened: number; clicked: number;
}

export function campaignRates(counts: CampaignMetricCounts) {
  const percent = (numerator: number, denominator: number) => denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
  return {
    deliveryRate: percent(counts.delivered, counts.sent),
    bounceRate: percent(counts.bounced, counts.sent),
    complaintRate: percent(counts.complained, counts.sent),
    openRate: percent(counts.opened, counts.delivered || counts.sent),
    clickRate: percent(counts.clicked, counts.delivered || counts.sent),
    ctr: percent(counts.clicked, counts.sent),
    ctor: percent(counts.clicked, counts.opened),
  };
}
