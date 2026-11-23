import React, { createContext, useContext } from "react";
import { staticFile } from "remotion";

export type MediaResolver = (path: string) => string;

export const MediaResolverContext = createContext<MediaResolver>(staticFile);

export const MediaResolverProvider: React.FC<{
  resolve: MediaResolver;
  children: React.ReactNode;
}> = ({ resolve, children }) => (
  <MediaResolverContext.Provider value={resolve}>{children}</MediaResolverContext.Provider>
);

export const useMediaSrc = (): MediaResolver => useContext(MediaResolverContext);

export type MediaErrorHandler = (src: string, err: unknown) => void;

export const MediaErrorContext = createContext<MediaErrorHandler | null>(null);

export const useMediaErrorProps = (): ((src: string) => { onError?: (err: unknown) => void }) => {
  const handler = useContext(MediaErrorContext);
  return (src) => (handler ? { onError: (err: unknown) => handler(src, err) } : {});
};
