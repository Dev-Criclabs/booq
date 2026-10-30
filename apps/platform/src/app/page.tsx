import { redirect } from 'next/navigation';

// The console opens on the clubs list (P1); a person who is not signed in is sent to sign in from there.
export default function Home() {
  redirect('/clubs');
}
