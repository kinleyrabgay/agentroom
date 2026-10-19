/** GraphQL documents for GitHub Projects v2. The owner kind (organization/user) is spliced in, since the root field differs. */

const ownerField = (ownerType: 'org' | 'user') => (ownerType === 'org' ? 'organization' : 'user');

export const projectMetaQuery = (ownerType: 'org' | 'user') => `
query($owner: String!, $number: Int!) {
  owner: ${ownerField(ownerType)}(login: $owner) {
    projectV2(number: $number) {
      id
      title
      fields(first: 50) {
        nodes {
          ... on ProjectV2SingleSelectField { id name options { id name color } }
        }
      }
    }
  }
}`;

const CONTENT = `
content {
  __typename
  ... on Issue {
    id number title url state updatedAt
    repository { nameWithOwner }
    labels(first: 10) { nodes { name color } }
    assignees(first: 10) { nodes { login avatarUrl } }
    closedByPullRequestsReferences(first: 5) { nodes { number url state title } }
  }
  ... on PullRequest {
    id number title url state updatedAt
    repository { nameWithOwner }
    labels(first: 10) { nodes { name color } }
    assignees(first: 10) { nodes { login avatarUrl } }
  }
  ... on DraftIssue {
    id title updatedAt
    assignees(first: 10) { nodes { login avatarUrl } }
  }
}`;

const FIELD_VALUES = `
fieldValues(first: 20) {
  nodes {
    __typename
    ... on ProjectV2ItemFieldSingleSelectValue { optionId name field { ... on ProjectV2FieldCommon { id name } } }
    ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { id name } } }
  }
}`;

export const itemsPageQuery = (ownerType: 'org' | 'user') => `
query($owner: String!, $number: Int!, $after: String) {
  viewer { login avatarUrl }
  owner: ${ownerField(ownerType)}(login: $owner) {
    projectV2(number: $number) {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id updatedAt ${FIELD_VALUES} ${CONTENT} }
      }
    }
  }
}`;

export const itemDetailQuery = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2Item {
      id updatedAt ${FIELD_VALUES} ${CONTENT}
      body: content {
        ... on Issue { body comments(last: 10) { nodes { author { login } body createdAt } } }
        ... on PullRequest { body comments(last: 10) { nodes { author { login } body createdAt } } }
        ... on DraftIssue { body }
      }
    }
  }
}`;

export const viewerQuery = `query { viewer { id login avatarUrl } }`;

export const addAssigneeMutation = `
mutation($assignable: ID!, $user: ID!) {
  addAssigneesToAssignable(input: { assignableId: $assignable, assigneeIds: [$user] }) { clientMutationId }
}`;

export const removeAssigneeMutation = `
mutation($assignable: ID!, $user: ID!) {
  removeAssigneesFromAssignable(input: { assignableId: $assignable, assigneeIds: [$user] }) { clientMutationId }
}`;
