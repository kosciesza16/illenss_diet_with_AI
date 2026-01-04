import { rest } from 'msw'

// Basic handlers for Supabase auth endpoints and OpenRouter
export const handlers = [
  // Example Supabase sign-in handler
  rest.post('https://your-supabase-url.supabase.co/auth/v1/token', async (req, res, ctx) => {
    const body = await req.json()
    if (body.grant_type === 'password') {
      // return mocked session
      return res(
        ctx.status(200),
        ctx.json({
          access_token: 'mocked_access_token',
          refresh_token: 'mocked_refresh_token',
          user: { id: 'user-id', email: body.username }
        })
      )
    }

    return res(ctx.status(400), ctx.json({ error: 'unsupported_grant_type' }))
  }),

  // OpenRouter mock for LLM requests
  rest.post('https://openrouter.ai/v1/chat/completions', async (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        id: 'mocked-chat',
        choices: [
          {
            message: { role: 'assistant', content: 'mocked response' }
          }
        ]
      })
    )
  })
]

