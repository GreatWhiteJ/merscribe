/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert'
import test from 'node:test'
import { parseDocument } from './parser.ts'

const fence = (er: string) => '```mermaid\n' + er + '\n```'

// Helper: the single ER edge's resolved field indices.
function erFields(er: string) {
  const { edges } = parseDocument(fence(er))
  assert.equal(edges.length, 1, 'expected exactly one relationship')
  const d = edges[0].data as any
  return { s: d.sourceFieldIndex, t: d.targetFieldIndex }
}

test('ER edge anchors PK row to the FK row (annotated)', () => {
  const { s, t } = erFields(`erDiagram
  Customer {
    int id PK
    string email UK
  }
  Order {
    int id PK
    int customerId FK "-> Customer"
  }
  Customer ||--o{ Order : "places"`)
  assert.equal(s, 0) // Customer.id (PK)
  assert.equal(t, 1) // Order.customerId (FK)
})

test('ER edge resolves FK by name when no comment is present', () => {
  const { s, t } = erFields(`erDiagram
  User {
    int id PK
    string handle
  }
  Post {
    int id PK
    int userId
    string body
  }
  User ||--o{ Post : "writes"`)
  assert.equal(s, 0) // User.id
  assert.equal(t, 1) // Post.userId (name match)
})

test('a descriptive label does not hijack a field it merely contains', () => {
  // "paid invoices" contains the word "paid" (a field) and substring "id";
  // the FK comment must win so the edge lands on accountId, not id or paid.
  const { s, t } = erFields(`erDiagram
  Account {
    int id PK
    string name
  }
  Invoice {
    int id PK
    int accountId FK "-> Account"
    bool paid
  }
  Account ||--o{ Invoice : "paid invoices"`)
  assert.equal(s, 0) // Account.id (PK)
  assert.equal(t, 1) // Invoice.accountId (FK) — NOT 0 (id) or 2 (paid)
})

test('a "src -> tgt" field-link label resolves both rows and is not shown', () => {
  // The serializer encodes a canvas-drawn field→field relationship as
  // "sourceField → targetField"; parsing must map both rows by name and hide it.
  const { edges } = parseDocument(fence(`erDiagram
  Customer {
    int id PK
    string email UK
  }
  Order {
    int id PK
    int customerId
  }
  Order ||--o{ Customer : "customerId → id"`))
  assert.equal(edges.length, 1)
  const d = edges[0].data as any
  assert.equal(d.sourceFieldIndex, 1) // Order.customerId
  assert.equal(d.targetFieldIndex, 0) // Customer.id
  assert.equal(edges[0].label, '') // the encoding is not a visible label
})

test('a referenced entity with no PK marker still anchors to a field row', () => {
  // Country has no PK -> must fall back to the first field, never the box center.
  const { s, t } = erFields(`erDiagram
  Country {
    string code
    string name
  }
  City {
    int id PK
    string countryCode FK "-> Country"
    string name
  }
  Country ||--o{ City : "has"`)
  assert.equal(s, 0) // Country.code (first-field fallback)
  assert.equal(t, 1) // City.countryCode (FK)
})
