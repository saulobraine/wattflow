import React, { AnchorHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { transitionNavigate } from "../utils/transitionNavigate";

interface TransitionLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children: ReactNode;
  className?: string;
}

export function TransitionLink({ href, children, className, onClick, ...restProps }: TransitionLinkProps) {
  const router = useRouter();

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    // Permite abertura em nova aba com Ctrl, Cmd, Shift ou botao do meio do mouse
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      if (onClick) {
        onClick(event);
      }
      return;
    }

    event.preventDefault();
    if (onClick) {
      onClick(event);
    }

    transitionNavigate(router, href);
  };

  return (
    <Link href={href} onClick={handleClick} className={className} {...restProps}>
      {children}
    </Link>
  );
}
