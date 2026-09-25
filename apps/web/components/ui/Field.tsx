'use client';

import { forwardRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-negative">{error}</p> : hint ? <p className="text-xs text-mute">{hint}</p> : null}
    </div>
  );
}

const base =
  'w-full rounded-md border border-line bg-canvas px-3.5 text-[16px] text-ink placeholder:text-mute focus:border-ink focus:outline-none focus:ring-2 focus:ring-primary/60 disabled:bg-canvas-soft';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className = '', ...p }, ref) => (
  <input ref={ref} className={`${base} h-12 ${className}`} {...p} />
));
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className = '', ...p }, ref) => (
  <select ref={ref} className={`${base} h-12 ${className}`} {...p} />
));
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className = '', ...p }, ref) => (
  <textarea ref={ref} className={`${base} min-h-[88px] py-3 ${className}`} {...p} />
));
Textarea.displayName = 'Textarea';

/** Password box with a show/hide eye, so people can check what they typed. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(({ className = '', ...p }, ref) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input ref={ref} type={show ? 'text' : 'password'} className={`${base} h-12 pr-12 ${className}`} {...p} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-md text-mute hover:bg-canvas-sunk hover:text-ink"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {show && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
