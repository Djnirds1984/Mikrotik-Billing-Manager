import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { SearchIcon, XMarkIcon } from '../constants.tsx';

export interface SearchableSelectOption {
    id: string;
    [key: string]: any;
}

interface SearchableSelectProps<T extends SearchableSelectOption> {
    /** All available options */
    options: T[];
    /** Currently selected option id */
    value: string;
    /** Called when user selects an option */
    onChange: (id: string) => void;
    /** Fields to filter on (used for default search) */
    searchFields: (keyof T)[];
    /** Optional override to produce custom search text per option */
    getOptionSearchText?: (option: T) => string;
    /** Render function for each option row */
    renderOption: (option: T, isSelected: boolean) => React.ReactNode;
    /** Placeholder for the search input */
    searchPlaceholder?: string;
    /** Placeholder shown in trigger button when nothing is selected */
    placeholder?: string;
    /** Text shown when search yields no results */
    emptyText?: string;
    /** Whether the list is loading */
    loading?: boolean;
    /** Disable the entire control */
    disabled?: boolean;
    /** Max visible items before "show more" */
    pageSize?: number;
    /** aria-label for the search input */
    ariaLabel?: string;
    /** Optional extra content rendered next to the trigger (e.g. QR scan button) */
    triggerAddon?: React.ReactNode;
}

export function SearchableSelect<T extends SearchableSelectOption>(props: SearchableSelectProps<T>) {
    const {
        options,
        value,
        onChange,
        searchFields,
        getOptionSearchText,
        renderOption,
        searchPlaceholder = 'Search...',
        placeholder = 'Select...',
        emptyText = 'No results',
        loading = false,
        disabled = false,
        pageSize = 50,
        ariaLabel = 'Search',
        triggerAddon,
    } = props;

    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [visibleCount, setVisibleCount] = useState(pageSize);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Build searchable text per option
    const getSearchText = useCallback(
        (option: T): string => {
            if (getOptionSearchText) return getOptionSearchText(option).toLowerCase();
            return searchFields
                .map((f) => String(option[f] ?? '').toLowerCase())
                .join(' ');
        },
        [searchFields, getOptionSearchText],
    );

    // Filtered list
    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return options;
        return options.filter((o) => getSearchText(o).includes(term));
    }, [options, search, getSearchText]);

    // Paginated slice
    const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
    const hasMore = filtered.length > visibleCount;

    // Selected option for display
    const selectedOption = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

    // Reset search + visible count when dropdown opens/closes
    useEffect(() => {
        if (isOpen) {
            setSearch('');
            setVisibleCount(pageSize);
            // Autofocus search input
            requestAnimationFrame(() => searchInputRef.current?.focus());
        }
    }, [isOpen, pageSize]);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Close on Escape when search is empty
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (search) {
                    setSearch('');
                } else {
                    setIsOpen(false);
                }
            }
        },
        [search],
    );

    // Handle option selection
    const handleSelect = useCallback(
        (id: string) => {
            onChange(id);
            setIsOpen(false);
            setSearch('');
        },
        [onChange],
    );

    // Option keyboard handler
    const handleOptionKeyDown = useCallback(
        (e: React.KeyboardEvent, id: string) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSelect(id);
            }
        },
        [handleSelect],
    );

    if (disabled && !isOpen) {
        return (
            <div className="flex gap-2">
                <div className="flex-1 p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-400 dark:text-slate-500 cursor-not-allowed">
                    {loading ? 'Loading...' : selectedOption ? renderOption(selectedOption, true) : placeholder}
                </div>
                {triggerAddon}
            </div>
        );
    }

    return (
        <div className="flex gap-2" ref={dropdownRef}>
            <div className="flex-1 relative">
                {/* Trigger button */}
                <button
                    type="button"
                    onClick={() => setIsOpen((v) => !v)}
                    className="w-full text-left p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between"
                >
                    <span className={selectedOption ? '' : 'text-slate-400 dark:text-slate-500'}>
                        {loading ? 'Loading...' : selectedOption ? renderOption(selectedOption, true) : placeholder}
                    </span>
                    <svg className="w-4 h-4 ml-2 flex-shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {/* Dropdown panel */}
                {isOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg max-h-80 flex flex-col">
                        {/* Search input */}
                        <div className="relative p-2 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
                            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setVisibleCount(pageSize);
                                }}
                                onKeyDown={handleKeyDown}
                                placeholder={searchPlaceholder}
                                aria-label={ariaLabel}
                                className="w-full pl-9 pr-8 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    aria-label="Clear search"
                                >
                                    <XMarkIcon className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        {/* Options list */}
                        <div ref={listRef} className="overflow-y-auto flex-1">
                            {visible.length === 0 ? (
                                <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                                    {search ? `No clients match "${search}"` : emptyText}
                                </div>
                            ) : (
                                visible.map((option) => {
                                    const isSelected = option.id === value;
                                    return (
                                        <div
                                            key={option.id}
                                            role="option"
                                            aria-selected={isSelected}
                                            tabIndex={0}
                                            onClick={() => handleSelect(option.id)}
                                            onKeyDown={(e) => handleOptionKeyDown(e, option.id)}
                                            className={`cursor-pointer outline-none focus:ring-1 focus:ring-blue-500 ${
                                                isSelected
                                                    ? 'bg-blue-50 dark:bg-blue-900/30'
                                                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                            }`}
                                        >
                                            {renderOption(option, isSelected)}
                                        </div>
                                    );
                                })
                            )}
                            {hasMore && (
                                <button
                                    type="button"
                                    onClick={() => setVisibleCount((c) => c + pageSize)}
                                    className="w-full px-3 py-2 text-center text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                                >
                                    + {filtered.length - visibleCount} more — show all
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {triggerAddon}
        </div>
    );
}
