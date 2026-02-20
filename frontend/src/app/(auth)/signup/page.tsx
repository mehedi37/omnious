import { redirect } from 'next/navigation';

/**
 * Signup page removed — OAuth-only auth.
 * GitHub/Google OAuth handles signup automatically on first login.
 * Redirect any old /signup links to /login.
 */
export default function SignupPage() {
  redirect('/login');
}
