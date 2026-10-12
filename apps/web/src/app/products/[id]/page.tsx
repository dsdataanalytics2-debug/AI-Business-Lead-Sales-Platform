'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Package,
  Target,
  ArrowLeft,
  ArrowRight,
  Edit2,
  DollarSign,
  Layers,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Building2,
  Users,
  Clock,
  X
} from 'lucide-react';
import {
  type ProductDto,
  type UpdateProductInput,
  type SalesMissionDetailDto,
  ProductStatus,
  SalesPriority,
  SalesMissionGoal,
  SALES_MISSION_GOAL_LABELS
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient } from '@/lib/api-client';

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params?.id as string;

  const [product, setProduct] = useState<ProductDto | null>(null);
  const [missions, setMissions] = useState<SalesMissionDetailDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<UpdateProductInput>({});

  const loadData = async () => {
    if (!productId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [prodData, missionsData] = await Promise.all([
        apiClient.getProduct(productId),
        apiClient.listSalesMissions({ productId, limit: 20 })
      ]);
      setProduct(prodData);
      setMissions(missionsData.missions || []);
      setEditFormData({
        name: prodData.name,
        description: prodData.description,
        category: prodData.category,
        stockQuantity: prodData.stockQuantity,
        sellingPrice: prodData.sellingPrice,
        costPrice: prodData.costPrice,
        currency: prodData.currency,
        brand: prodData.brand,
        salesPriority: prodData.salesPriority as SalesPriority,
        status: prodData.status as ProductStatus
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to load product');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [productId]);

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setIsUpdating(true);
    setEditError(null);
    try {
      const updated = await apiClient.updateProduct(product.id, editFormData);
      setProduct(updated);
      setShowEditModal(false);
    } catch (err: any) {
      setEditError(err?.message || 'Failed to update product');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Navigation & Header */}
        <div className="flex items-center justify-between">
          <Link
            href="/products"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Products</span>
          </Link>

          {product && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowEditModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit Product</span>
              </button>

              <Link
                href={`/sales-missions/new?productId=${product.id}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition shadow-md shadow-indigo-600/20"
              >
                <Target className="w-3.5 h-3.5 text-indigo-200" />
                <span>Launch Sales Mission</span>
              </Link>
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <span className="text-sm">Loading product details...</span>
          </div>
        ) : !product ? (
          <div className="p-12 text-center text-slate-400">Product not found</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Main Product Specs */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-6 space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {product.status}
                      </span>
                      {product.category && (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                          {product.category}
                        </span>
                      )}
                    </div>
                    <h1 className="text-2xl font-bold text-slate-100">{product.name}</h1>
                    {product.brand && (
                      <p className="text-xs text-slate-400 mt-0.5">Brand: {product.brand}</p>
                    )}
                  </div>

                  <span
                    className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${
                      product.salesPriority === SalesPriority.URGENT
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        : product.salesPriority === SalesPriority.HIGH
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {product.salesPriority} Priority
                  </span>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800/60">
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Product Description
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                    {product.description}
                  </p>
                </div>

                {/* Key Spec Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800/60">
                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                    <span className="text-[11px] text-slate-400 font-medium block">Stock On Hand</span>
                    <span
                      className={`text-lg font-bold ${
                        product.stockQuantity > 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {product.stockQuantity.toLocaleString()}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                    <span className="text-[11px] text-slate-400 font-medium block">Selling Price</span>
                    <span className="text-lg font-bold text-slate-100">
                      {product.sellingPrice != null
                        ? `${product.sellingPrice} ${product.currency || 'BDT'}`
                        : '—'}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                    <span className="text-[11px] text-slate-400 font-medium block">Cost Price</span>
                    <span className="text-lg font-bold text-slate-300">
                      {product.costPrice != null
                        ? `${product.costPrice} ${product.currency || 'BDT'}`
                        : '—'}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                    <span className="text-[11px] text-slate-400 font-medium block">SKU</span>
                    <span className="text-sm font-semibold text-slate-300 truncate block mt-1">
                      {product.sku || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Col: Associated Sales Missions */}
            <div className="space-y-4">
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-indigo-400" />
                    <h2 className="text-sm font-bold text-slate-100">Sales Missions</h2>
                  </div>
                  <span className="text-xs text-slate-400">{missions.length} active</span>
                </div>

                {missions.length === 0 ? (
                  <div className="p-6 text-center bg-slate-900/40 border border-slate-800 rounded-xl space-y-3">
                    <p className="text-xs text-slate-400">
                      No sales missions have been launched for this product yet.
                    </p>
                    <Link
                      href={`/sales-missions/new?productId=${product.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                    >
                      <Target className="w-3.5 h-3.5" />
                      <span>Start First Mission</span>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {missions.map((m) => (
                      <Link
                        key={m.id}
                        href={`/sales-missions/${m.id}`}
                        className="block p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition group space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-200 group-hover:text-indigo-300 transition truncate">
                            {m.name}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {m.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>{SALES_MISSION_GOAL_LABELS[m.goal as SalesMissionGoal] || m.goal}</span>
                          <span>{m.buyerStats?.found || 0} buyers</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Edit Product Modal */}
        {showEditModal && product && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowEditModal(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Edit Product</h2>
                  <p className="text-xs text-slate-400">Update specifications and inventory stock</p>
                </div>
              </div>

              {editError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              <form onSubmit={handleUpdateProduct} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Product Name</label>
                  <input
                    type="text"
                    required
                    value={editFormData.name || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
                  <textarea
                    rows={3}
                    required
                    value={editFormData.description || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
                    <input
                      type="text"
                      value={editFormData.category || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Stock Quantity</label>
                    <input
                      type="number"
                      min={0}
                      value={editFormData.stockQuantity ?? 0}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, stockQuantity: Number(e.target.value) })
                      }
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
                      value={editFormData.sellingPrice ?? ''}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          sellingPrice: e.target.value ? Number(e.target.value) : undefined
                        })
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Cost Price</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={editFormData.costPrice ?? ''}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          costPrice: e.target.value ? Number(e.target.value) : undefined
                        })
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition disabled:opacity-50"
                  >
                    {isUpdating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Updating...</span>
                      </>
                    ) : (
                      <span>Save Changes</span>
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
