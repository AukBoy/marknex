import { useEffect, useRef, useState } from 'react';

// Lazy load images using Intersection Observer
export function useLazyLoadImage(src) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [imageSrc, setImageSrc] = useState(null);
    const ref = useRef(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        setImageSrc(src);
                        setIsLoaded(true);
                        observer.unobserve(ref.current);
                    }
                });
            },
            { threshold: 0.1 }
        );

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => {
            if (ref.current) {
                observer.unobserve(ref.current);
            }
        };
    }, [src]);

    return { ref, imageSrc, isLoaded };
}

// Debounce hook for search/filter performance
export function useDebounce(value, delay = 300) {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => clearTimeout(handler);
    }, [value, delay]);

    return debouncedValue;
}

// Virtual scrolling hook for large lists
export function useVirtualScroll(items, itemHeight, containerHeight) {
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: Math.ceil(containerHeight / itemHeight) });
    const containerRef = useRef(null);

    const handleScroll = () => {
        if (!containerRef.current) return;

        const scrollTop = containerRef.current.scrollTop;
        const start = Math.floor(scrollTop / itemHeight);
        const end = start + Math.ceil(containerHeight / itemHeight) + 1;

        setVisibleRange({ start, end: Math.min(end, items.length) });
    };

    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll);
            return () => container.removeEventListener('scroll', handleScroll);
        }
    }, [itemHeight, containerHeight, items.length]);

    const visibleItems = items.slice(visibleRange.start, visibleRange.end);
    const offsetY = visibleRange.start * itemHeight;

    return {
        containerRef,
        visibleItems,
        offsetY,
        totalHeight: items.length * itemHeight,
        visibleRange
    };
}
