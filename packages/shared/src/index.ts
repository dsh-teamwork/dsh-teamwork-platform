/**
 * @dsh-teamwork/shared — what the clients written in TypeScript agree about:
 * the languages the product ships in and how a person's preference picks
 * one, the marks of the model providers and how a model finds its own, the
 * providers a console offers to add, named as Models.dev names them, the
 * preset avatars both clients draw, how an amount of points is shown, and how
 * a team's preset or plugin reaches a member's DSH.
 * Isomorphic: nothing here may reach for Node, the DOM or React. A knowledge
 * document's rules are entries of their own, so their libraries reach only
 * the pages that read documents: `@dsh-teamwork/shared/knowledge-format`
 * (front matter, `[[links]]`, attachments), `/knowledge-properties` (its
 * YAML properties), `/knowledge-tree` (a space's folders nested, links
 * resolved) and `/knowledge-diff` (the line difference). The wire is `api/openapi.yaml`, not this
 * package.
 */

export * from './asset-choices';
export * from './avatars';
export * from './locales';
export * from './points';
export * from './provider-catalog';
export * from './providers';
