import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'dark' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-on hover:bg-primary-active active:brightness-95',
  dark: 'bg-ink text-white hover:bg-ink-soft',
  secondary: 'bg-canvas-sunk text-ink hover:bg-line',
  outline: 'bg-canvas text-ink border border-line hover:border-ink',
  ghost: 'bg-transparent text-ink hover:bg-canvas-sunk',
  danger: 'bg-negative text-white hover:bg-negative-deep',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-sm',
  md: 'h-11 px-4 text-[15px] rounded-md',
  lg: 'h-12 px-5 text-base rounded-md',
  xl: 'h-14 px-6 text-[17px] rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, block, className = '', disabled, children, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition-colors select-none disabled:opacity-45 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
