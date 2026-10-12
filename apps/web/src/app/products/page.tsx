'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Package,
  Plus,
  Search,
  Target,
  Edit2,
  AlertCircle,
  Loader2,
  CheckCircle2,
  DollarSign,
  Layers,
  ArrowRight,
  X
} from 'lucide-react';
import {
  type ProductDto,
  type CreateProductInput,
  ProductStatus,
  SalesPriority
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient, ApiClientError } from '@/lib/api-client';

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Add Product Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [formData, setFormData] = useState<CreateProductInput>({
    name: '',
    description: '',
    category: '',
    stockQuantity: 100,
    sellingPrice: undefined,
    costPrice: undefined,
    currency: 'BDT',
    brand: '',
    targetMarket: 'Bangladesh',
    salesPriority: SalesPriority.NORMAL,
    status: ProductStatus.ACTIVE
  });

  const loadProducts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.listProducts({
        search: searchQuery.trim() || undefined,
        category: categoryFilter || undefined,
        limit: 50
      });
      setProducts(res.products || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load products');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, [categoryFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadProducts();
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      setFormError('Product name is required');
      return;
    }
    if (!formData.description?.trim()) {
      setFormError('Product description is required');
      return;
    }
    if (formData.description.trim().length > 4000) {
      setFormError('Product description must be 4000 characters or fewer.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      const created = await apiClient.createProduct(formData);
      setProducts((prev) => [created, ...prev]);
      setShowAddModal(false);
      setFormData({
        name: '',
        description: '',
        category: '',
        stockQuantity: 100,
        currency: 'BDT',
        brand: '',
        targetMarket: 'Bangladesh',
        salesPriority: SalesPriority.NORMAL,
        status: ProductStatus.ACTIVE
      });
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create product');
    } finally {
      setIsSubmitting(false);
    }
  };

  const categories = Array.from(
    new Set(products.map((p) => p.category).filter(Boolean) as string[])
  );

  const totalStock = products.reduce((acc, p) => acc + (p.stockQuantity || 0), 0);
  const highPriorityCount = products.filter(
    (p) => p.salesPriority === SalesPriority.HIGH || p.salesPriority === SalesPriority.URGENT
  ).length;

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <Package className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Product Catalog</h1>
                <p className="text-sm text-slate-400">
                  Manage inventory and initiate AI-powered Sales Missions
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-indigo-600/20"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
          </div>
        </div>

        {/* Metrics Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Products</div>
            <div className="text-2xl font-bold text-slate-100 mt-1">{products.length}</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Inventory Units</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{totalStock.toLocaleString()}</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">High / Urgent Priority</div>
            <div className="text-2xl font-bold text-amber-400 mt-1">{highPriorityCount}</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Categories</div>
            <div className="text-2xl font-bold text-indigo-400 mt-1">{categories.length || 1}</div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products by name or description..."
              className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50"
            />
          </form>

          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-indigo-500/50"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => loadProducts()}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition"
          >
            Refresh
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Product Cards List */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <span className="text-sm">Loading products catalog...</span>
          </div>
        ) : products.length === 0 ? (
          <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-12 text-center max-w-lg mx-auto space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-200">No products found</h3>
              <p className="text-sm text-slate-400 mt-1">
                Add your first product to kick off AI Sales Missions and find ready buyers.
              </p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add First Product</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((prod) => (
              <div
                key={prod.id}
                className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-700 transition flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-100 text-base leading-snug">
                        {prod.name}
                      </h3>
                      {prod.brand && (
                        <span className="text-xs text-slate-400 font-medium">by {prod.brand}</span>
                      )}
                    </div>
                    {prod.category && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-800 text-indigo-300 border border-indigo-500/20 flex-shrink-0">
                        {prod.category}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 mt-2 line-clamp-3 leading-relaxed">
                    {prod.description}
                  </p>
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-800/60">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Stock Available:</span>
                    <span
                      className={`font-semibold ${
                        (prod.stockQuantity || 0) > 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {prod.stockQuantity} units
                    </span>
                  </div>

                  {prod.sellingPrice != null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Price:</span>
                      <span className="font-semibold text-slate-200">
                        {prod.sellingPrice} {prod.currency || 'BDT'}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Priority:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        prod.salesPriority === SalesPriority.URGENT
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : prod.salesPriority === SalesPriority.HIGH
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {prod.salesPriority}
                    </span>
                  </div>

                  {/* Start Sales Mission CTA */}
                  <Link
                    href={`/sales-missions/new?productId=${prod.id}`}
                    className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-indigo-600/90 hover:bg-indigo-600 text-white text-xs font-semibold transition group shadow-sm shadow-indigo-600/20"
                  >
                    <Target className="w-3.5 h-3.5 text-indigo-200" />
                    <span>Launch Sales Mission</span>
                    <ArrowRight className="w-3.5 h-3.5 text-indigo-300 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Product Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowAddModal(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Add New Product</h2>
                  <p className="text-xs text-slate-400">Enter product info to analyze buyer targets</p>
                </div>
              </div>

              {formError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleCreateProduct} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Product Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Diamum, Portable Mini Blender, Organic Green Tea"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-300">
                      Description <span className="text-rose-400">*</span>
                    </label>
                    <span
                      className={`text-[11px] font-mono ${
                        formData.description.length > 4000
                          ? 'text-rose-400 font-semibold'
                          : formData.description.length > 3500
                          ? 'text-amber-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {formData.description.length} / 4000
                    </span>
                  </div>
                  <textarea
                    required
                    rows={3}
                    maxLength={4000}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="e.g. High-demand kitchenware blender with rechargeable battery..."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  {formData.description.length > 4000 && (
                    <p className="text-xs text-rose-400 mt-1">
                      Product description must be 4000 characters or fewer.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
                    <input
                      type="text"
                      value={formData.category || ''}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      placeholder="e.g. Healthcare, Kitchenware"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Stock Quantity</label>
                    <input
                      type="number"
                      min={0}
                      value={formData.stockQuantity}
                      onChange={(e) => setFormData({ ...formData, stockQuantity: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Selling Price</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={formData.sellingPrice || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          sellingPrice: e.target.value ? Number(e.target.value) : undefined
                        })
                      }
                      placeholder="1200"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Currency</label>
                    <input
                      type="text"
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                      placeholder="BDT"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Brand</label>
                    <input
                      type="text"
                      value={formData.brand || ''}
                      onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                      placeholder="e.g. LeadAtlas Essentials"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Priority</label>
                    <select
                      value={formData.salesPriority}
                      onChange={(e) => setFormData({ ...formData, salesPriority: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value={SalesPriority.NORMAL}>Normal</option>
                      <option value={SalesPriority.HIGH}>High</option>
                      <option value={SalesPriority.URGENT}>Urgent</option>
                      <option value={SalesPriority.LOW}>Low</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Product</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
