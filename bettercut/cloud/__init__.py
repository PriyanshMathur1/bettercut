"""BetterCut Cloud: the multi-user, hosted version of the editor.

Same pipeline and renderer as the local editor (`bettercut.server`), plus sign-in, per-user projects in a
database, durable media storage (local disk or any S3-compatible store such as Cloudflare R2), a job queue,
bring-your-own-model AI editing and per-user memory. Run with `python -m bettercut cloud`.
"""
