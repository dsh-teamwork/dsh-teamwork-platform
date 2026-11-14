import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** A sign-in screen: one card in the middle of the page. */
export function CardPage({ title, description, children, wide = false }: { title: string; description?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className={wide ? 'w-full max-w-md' : 'w-full max-w-sm'}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </main>
  );
}

/** Shown while the session is read. */
export function Loading() {
  return <main className="min-h-dvh" aria-busy="true" />;
}

/** An error code in the reader's language. */
export function Failure({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** The tab's title, as the Next pages set it: "Page · DSH Teamwork". */
export function useTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · DSH Teamwork` : 'DSH Teamwork';
  }, [title]);
}
