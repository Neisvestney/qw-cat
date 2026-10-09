import {useCallback, useEffect, useState} from "react";

function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({width: 0, height: 0});

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setSize({width: element.offsetWidth, height: element.offsetHeight});
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const ref = useCallback((node: T | null) => setElement(node), []);

  return [ref, size] as const;
}

export default useElementSize;
