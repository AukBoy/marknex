import React from 'react';
import { Search, X } from 'lucide-react';
import './SearchBar.css';

function SearchBar({ value, onChange, placeholder = "Search...", onClear }) {
    return (
        <div className="search-bar">
            <Search size={18} className="search-icon" />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="search-input"
            />
            {value && (
                <button
                    onClick={() => {
                        onChange('');
                        onClear?.();
                    }}
                    className="search-clear"
                    title="Clear search"
                >
                    <X size={18} />
                </button>
            )}
        </div>
    );
}

export default SearchBar;
