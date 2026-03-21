export interface SubscriptionLike {
  subscriberPartnerId: string;
  providerPartnerId: string;
  status: string;
}

export type RelationshipUiStatus =
  | 'connected'
  | 'partial'
  | 'pending'
  | 'suspended'
  | 'terminated'
  | 'none';

export interface RelationshipSummary {
  outboundStatus: string | null;
  inboundStatus: string | null;
  uiStatus: RelationshipUiStatus;
  label: string;
  hasAnyRecord: boolean;
  hasNonTerminatedRecord: boolean;
}

const STATUS_PRIORITY = ['active', 'approved', 'requested', 'suspended', 'terminated'];

function pickHighestStatus(statuses: string[]): string | null {
  for (const status of STATUS_PRIORITY) {
    if (statuses.includes(status)) return status;
  }

  return statuses[0] ?? null;
}

export function getDirectionalStatus(
  subscriptions: SubscriptionLike[],
  subscriberPartnerId: string,
  providerPartnerId: string
): string | null {
  const statuses = subscriptions
    .filter(
      (sub) =>
        sub.subscriberPartnerId === subscriberPartnerId &&
        sub.providerPartnerId === providerPartnerId
    )
    .map((sub) => sub.status);

  return pickHighestStatus(statuses);
}

export function summarizeRelationship(
  subscriptions: SubscriptionLike[],
  myPartnerId: string | null,
  partnerId: string
): RelationshipSummary {
  if (!myPartnerId) {
    return {
      outboundStatus: null,
      inboundStatus: null,
      uiStatus: 'none',
      label: 'No relationship',
      hasAnyRecord: false,
      hasNonTerminatedRecord: false,
    };
  }

  const outboundStatus = getDirectionalStatus(subscriptions, myPartnerId, partnerId);
  const inboundStatus = getDirectionalStatus(subscriptions, partnerId, myPartnerId);
  const hasAnyRecord = Boolean(outboundStatus || inboundStatus);
  const hasNonTerminatedRecord = [outboundStatus, inboundStatus].some(
    (status) => status !== null && status !== 'terminated'
  );

  const outboundActive = outboundStatus === 'active';
  const inboundActive = inboundStatus === 'active';
  const outboundPending = outboundStatus === 'requested' || outboundStatus === 'approved';
  const inboundPending = inboundStatus === 'requested' || inboundStatus === 'approved';
  const outboundSuspended = outboundStatus === 'suspended';
  const inboundSuspended = inboundStatus === 'suspended';

  if (outboundActive && inboundActive) {
    return {
      outboundStatus,
      inboundStatus,
      uiStatus: 'connected',
      label: 'Two-way active',
      hasAnyRecord,
      hasNonTerminatedRecord,
    };
  }

  if (outboundActive) {
    return {
      outboundStatus,
      inboundStatus,
      uiStatus: inboundStatus ? 'partial' : 'connected',
      label: inboundStatus ? `Outbound active · inbound ${inboundStatus}` : 'Outbound active',
      hasAnyRecord,
      hasNonTerminatedRecord,
    };
  }

  if (inboundActive) {
    return {
      outboundStatus,
      inboundStatus,
      uiStatus: 'partial',
      label: outboundStatus ? `Inbound active · outbound ${outboundStatus}` : 'Inbound active only',
      hasAnyRecord,
      hasNonTerminatedRecord,
    };
  }

  if (outboundPending) {
    return {
      outboundStatus,
      inboundStatus,
      uiStatus: 'pending',
      label: 'Awaiting partner approval',
      hasAnyRecord,
      hasNonTerminatedRecord,
    };
  }

  if (outboundSuspended) {
    return {
      outboundStatus,
      inboundStatus,
      uiStatus: 'suspended',
      label: 'Outbound subscription suspended',
      hasAnyRecord,
      hasNonTerminatedRecord,
    };
  }

  if (inboundPending) {
    return {
      outboundStatus,
      inboundStatus,
      uiStatus: 'partial',
      label: 'Partner request still in progress',
      hasAnyRecord,
      hasNonTerminatedRecord,
    };
  }

  if (inboundSuspended) {
    return {
      outboundStatus,
      inboundStatus,
      uiStatus: 'partial',
      label: 'Inbound subscription suspended',
      hasAnyRecord,
      hasNonTerminatedRecord,
    };
  }

  if (outboundStatus === 'terminated' || inboundStatus === 'terminated') {
    return {
      outboundStatus,
      inboundStatus,
      uiStatus: 'terminated',
      label: 'Relationship terminated',
      hasAnyRecord,
      hasNonTerminatedRecord,
    };
  }

  return {
    outboundStatus,
    inboundStatus,
    uiStatus: 'none',
    label: 'No relationship',
    hasAnyRecord,
    hasNonTerminatedRecord,
  };
}
