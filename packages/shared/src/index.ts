/**
 * @dsh-teamwork/shared — what the clients written in TypeScript agree about:
 * the languages the product ships in and how a person's preference picks
 * one, the marks of the model providers and how a model finds its own, the
 * providers a console offers to add, named as Models.dev names them, and
 * the preset avatars both clients draw, and how an amount of points is shown. Isomorphic: nothing here may reach
 * for Node, the DOM or React. The wire is `api/openapi.yaml`, not this
 * package.
 */

export * from './avatars';
export * from './locales';
export * from './points';
export * from './provider-catalog';
export * from './providers';
