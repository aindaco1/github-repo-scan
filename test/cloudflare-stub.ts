export class WorkflowEntrypoint<E, P> {
  env: E;
  constructor(_ctx: unknown, env: E) {
    this.env = env;
  }
}
