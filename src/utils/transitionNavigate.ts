import { NextRouter } from "next/router";

/**
 * Executa uma transicao de pagina com suporte nativo a View Transitions API.
 * Aguarda a reconciliacao e conclusao da rota no Next.js (routeChangeComplete)
 * antes de finalizar a captura visual, garantindo animacao fluida sem flashes.
 */
export function transitionNavigate(router: NextRouter, href: string): void {
  if (router.asPath === href || router.pathname === href) {
    return;
  }

  const documentWithTransition =
    typeof document !== "undefined"
      ? (document as unknown as {
          startViewTransition?: (updateCallback: () => Promise<unknown>) => void;
        })
      : null;

  if (!documentWithTransition?.startViewTransition) {
    router.push(href);
    return;
  }

  documentWithTransition.startViewTransition(() => {
    return new Promise<void>((resolve) => {
      let resolved = false;

      const finish = () => {
        if (!resolved) {
          resolved = true;
          router.events.off("routeChangeComplete", finish);
          router.events.off("routeChangeError", finish);
          resolve();
        }
      };

      // Limite maximo de espera para evitar bloqueio caso a rota falhe silenciosamente
      const timeoutId = setTimeout(finish, 2500);

      const onDone = () => {
        clearTimeout(timeoutId);
        finish();
      };

      router.events.on("routeChangeComplete", onDone);
      router.events.on("routeChangeError", onDone);

      router.push(href).catch(onDone);
    });
  });
}
