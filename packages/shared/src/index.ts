/**
 * @dsh-teamwork/shared — what the clients written in TypeScript agree about:
 * the languages the product ships in and how a person's preference picks
 * one, the marks of the model providers and how a model finds its own, the
 * providers a console offers to add, named as Models.dev names them, the
 * preset avatars both clients draw, how an amount of points is shown, and how
 * a team's preset or plugin reaches a member's DSH.
 * Isomorphic: nothing here may reach for Node, the DOM or React. The line
 * difference of a knowledge document is an entry of its own,
 * `@dsh-teamwork/shared/knowledge-diff`, so the `diff` library reaches only
 * the pages that compare texts. The wire is `api/openapi.yaml`, not this
 * package.
 */

export * from './asset-choices';
export * from './avatars';
export * from './locales';
export * from './points';
export * from './provider-catalog';
export * from './providers';
