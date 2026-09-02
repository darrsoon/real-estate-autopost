"use client";

import { useState } from 'react';

export default function ReducedPricePage() {
  const [project, setProject] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!project || !originalPrice) return alert('Enter project and original price');
    setLoading(true);
    try {
      const res = await fetch('/api/reduced/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalPrice, projectName: project })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPosts(data.posts);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight bb-ink">Reduced Price Flow</h2>
        <p className="bb-ink-3">Search for old Telegram posts using MTProto (GramJS).</p>
      </div>

      <div className="bb-surface border bb-edge rounded-xl p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium bb-ink-2 mb-1">Project</label>
            <input 
              type="text" 
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full bb-surface border bb-edge rounded-md p-2 bb-ink" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium bb-ink-2 mb-1">Original Price (from sheet)</label>
            <input 
              type="text" 
              value={originalPrice}
              onChange={(e) => setOriginalPrice(e.target.value)}
              className="w-full bb-surface border bb-edge rounded-md p-2 bb-ink" 
            />
          </div>
        </div>

        <button 
          onClick={handleSearch}
          disabled={loading}
          className="bb-fill-accent hover:bb-fill-accent text-white font-semibold py-2 px-4 rounded-md transition-colors"
        >
          {loading ? 'Searching...' : 'Search Telegram'}
        </button>
      </div>

      {posts.length > 0 && (
        <div className="bb-surface border bb-edge rounded-xl p-4 sm:p-6 space-y-4">
          <h3 className="text-lg font-medium bb-ink">Candidates found ({posts.length})</h3>
          <div className="space-y-4">
            {posts.map(post => (
              <div key={post.id} className="bb-surface p-4 rounded border bb-edge">
                <p className="text-sm bb-ink-3 mb-2">{post.date}</p>
                <p className="text-sm bb-ink whitespace-pre-wrap">{post.text}</p>
                <a href={post.link} target="_blank" rel="noreferrer" className="bb-accent hover:underline text-sm mt-2 block">
                  Open in Telegram
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
