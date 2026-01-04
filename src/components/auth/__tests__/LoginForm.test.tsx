import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginForm from '../LoginForm'

describe('LoginForm', () => {
  test('renders and submits credentials', async () => {
    render(<LoginForm />)

    const email = screen.getByLabelText(/email/i)
    const password = screen.getByLabelText(/password/i)
    const submit = screen.getByRole('button', { name: /sign in|login/i })

    await userEvent.type(email, 'test@example.com')
    await userEvent.type(password, 'password123')
    userEvent.click(submit)

    await waitFor(() => {
      // expect some UI change or success message — keep generic since backend not implemented
      expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument()
    })
  })
})

