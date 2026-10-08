export enum Membership {
  Member = "member",
}

// Preserve the JSON contract's string values at the API boundary.
export type MembershipValue = `${Membership}`;
