(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FrugalCost = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIZED_CATEGORIES = ['shoes', 'clothes'];

  function round2(n) {
    return Number((Number(n) || 0).toFixed(2));
  }

  function resolveChannel(shipping, deliveryType) {
    const channels = shipping && shipping.channels;
    if (!channels) {
      // Legacy flat fallback support
      const base = Number(shipping?.baseFee ?? 0);
      const easy = Number(shipping?.easyboxFee ?? base);
      return {
        effectiveDeliveryType: deliveryType,
        channel: {
          available: true,
          fee: deliveryType === 'easybox' ? easy : deliveryType === 'clickAndCollect' ? 0 : base,
          freeThreshold: shipping?.freeThreshold ?? null,
          requiresOnlinePay: false,
          maxWeightKg: null,
          freeMaxWeightKg: null,
        },
        fallbackNote: null,
      };
    }

    if (deliveryType === 'easybox') {
      if (channels.easybox && channels.easybox.available !== false) {
        return { effectiveDeliveryType: 'easybox', channel: channels.easybox, fallbackNote: null };
      }
      if (channels.fanbox && channels.fanbox.available !== false) {
        return { effectiveDeliveryType: 'fanbox', channel: channels.fanbox, fallbackNote: null };
      }
      if (channels.courier && channels.courier.available !== false) {
        return { effectiveDeliveryType: 'courier', channel: channels.courier, fallbackNote: 'Locker indisponibil — curier' };
      }
    } else if (deliveryType === 'clickAndCollect') {
      if (channels.clickAndCollect && channels.clickAndCollect.available !== false) {
        return { effectiveDeliveryType: 'clickAndCollect', channel: channels.clickAndCollect, fallbackNote: null };
      }
      if (channels.courier && channels.courier.available !== false) {
        return { effectiveDeliveryType: 'courier', channel: channels.courier, fallbackNote: 'Ridicare indisponibilă — curier' };
      }
      if (channels.easybox && channels.easybox.available !== false) {
        return { effectiveDeliveryType: 'easybox', channel: channels.easybox, fallbackNote: 'Ridicare indisponibilă — locker' };
      }
    }

    if (channels.courier && channels.courier.available !== false) {
      return { effectiveDeliveryType: 'courier', channel: channels.courier, fallbackNote: null };
    }
    const anyChannelKey = Object.keys(channels).find((k) => channels[k] && channels[k].available !== false);
    if (anyChannelKey) {
      return { effectiveDeliveryType: anyChannelKey, channel: channels[anyChannelKey], fallbackNote: null };
    }
    return {
      effectiveDeliveryType: deliveryType,
      channel: { available: false, fee: 0, freeThreshold: null },
      fallbackNote: null,
    };
  }

  function evaluateMembershipFreeShipping({
    shipping,
    businessModel,
    marketplace,
    effectiveDeliveryType,
    discountedPrice,
    memberships,
  }) {
    const prog = shipping?.membershipProgram;
    if (!prog) return null;

    const programId = typeof prog === 'string' ? prog : prog.programId;
    if (!programId) return null;

    if (programId === 'emag_genius') {
      const geniusTier = memberships?.emagGenius || 'none';
      if (geniusTier === 'none') return null;

      // Fail-closed 1P/3P Genius rule
      const geniusEligible = businessModel === '1p' || marketplace?.isGeniusEligible === true;
      if (!geniusEligible) return null;
      if (marketplace?.sellerType === '3p' && marketplace?.isGeniusEligible !== true) return null;

      if (effectiveDeliveryType === 'easybox' || effectiveDeliveryType === 'fanbox') {
        const lockerThresh = Number(prog.lockerFreeThreshold ?? 30);
        if (discountedPrice >= lockerThresh) {
          return 'Gratuit cu eMAG Genius';
        }
      } else if (effectiveDeliveryType === 'courier' && geniusTier === 'premium') {
        const courierThresh = Number(prog.courierFreeThreshold ?? 100);
        if (discountedPrice >= courierThresh) {
          return 'Gratuit cu Genius Premium';
        }
      }
      return null;
    }

    if (programId === 'farmacia_tei_elite' && memberships?.farmaciaTeiElite === true) {
      const lockerThresh = Number(prog.lockerFreeThreshold ?? 0);
      if ((effectiveDeliveryType === 'easybox' || effectiveDeliveryType === 'fanbox') && discountedPrice >= lockerThresh) {
        return 'Gratuit cu Tei ELITE';
      }
      return null;
    }

    if (programId === 'sephora_gold' && memberships?.sephoraGold === true) {
      return 'Gratuit cu Sephora Gold';
    }

    return null;
  }

  /**
   * Calculate full landed offer costs with fail-closed 1P/3P Genius,
   * PC Garage ramburs/online-only rules, dynamic checkout, and ramburs limits.
   */
  function calculateOfferCosts(offer, options = {}) {
    const {
      deliveryType = 'easybox',
      paymentMethod = 'card',
      memberships = {},
      voucherPercent = 0,
      voucherStoreId = 'all',
    } = options || {};

    const rawPrice = Number(offer?.rawPrice ?? offer?.price ?? offer?.originalPrice ?? 0);
    const validPrice = Number.isFinite(rawPrice) && rawPrice > 0 ? round2(rawPrice) : 0;

    const storeId = offer?.storeId || '';
    const clampedPct = Math.min(Math.max(Number(voucherPercent) || 0, 0), 50);
    const voucherApplies = clampedPct > 0 && (!voucherStoreId || voucherStoreId === 'all' || voucherStoreId === storeId);
    const appliedVoucherPercent = voucherApplies ? clampedPct : 0;
    const discountedPrice = round2(validPrice * (1 - appliedVoucherPercent / 100));

    const shipping = offer?.shippingProfile || offer?.shipping || {};
    const payment = offer?.paymentProfile || offer?.payment || (shipping?.ramburs ? { ramburs: shipping.ramburs } : {});
    const businessModel = offer?.businessModel || '1p';
    const marketplace = offer?.marketplace || null;

    const sellerType = marketplace?.sellerType || (businessModel === '1p' ? '1p' : 'unknown');
    const is3PWarning = sellerType === '3p'
      || (businessModel === 'marketplace_hybrid' && sellerType !== '1p' && marketplace?.isGeniusEligible !== true);

    const { effectiveDeliveryType, channel, fallbackNote } = resolveChannel(shipping, deliveryType);

    // Weight check if offer specifies weightKg
    const offerWeightKg = offer?.weightKg != null
      ? Number(offer.weightKg)
      : (offer?.attributes?.weightG != null ? offer.attributes.weightG / 1000 : null);

    // Evaluate ramburs rules
    const ramburs = payment?.ramburs || { allowed: true, fee: Number(shipping?.rambursFee ?? 0) };
    let rambursAvailable = true;
    let rambursWarning = null;
    let rambursFee = 0;
    const rambursNonRefundable = Boolean(ramburs.nonRefundableOnReturn);

    if (paymentMethod === 'ramburs') {
      if (ramburs.allowed === false) {
        rambursAvailable = false;
        rambursWarning = 'Plata ramburs indisponibilă';
      } else if (channel?.requiresOnlinePay === true || (Array.isArray(ramburs.disabledOnChannels) && ramburs.disabledOnChannels.includes(effectiveDeliveryType))) {
        rambursAvailable = false;
        rambursWarning = `${effectiveDeliveryType === 'easybox' ? 'Easybox' : 'Livrarea'} necesită plată online cu cardul`;
      } else if (ramburs.maxOrderRon != null && discountedPrice > Number(ramburs.maxOrderRon)) {
        rambursAvailable = false;
        rambursWarning = `Ramburs indisponibil peste ${ramburs.maxOrderRon} lei`;
      } else if (ramburs.maxWeightKg != null && offerWeightKg != null && offerWeightKg > Number(ramburs.maxWeightKg)) {
        rambursAvailable = false;
        rambursWarning = `Ramburs indisponibil peste ${ramburs.maxWeightKg} kg`;
      } else {
        rambursFee = round2(Number(ramburs.fee ?? 0));
      }
    }

    // Dynamic checkout / unknown 3P shipping check
    const isDynamicBulky = shipping?.bulkyPolicy === 'dynamic_checkout_only'
      || (Boolean(marketplace?.isBulky) && shipping?.bulkyPolicy === 'surcharge_or_excluded');
    const isUnknown3PShipping = sellerType === '3p'
      && businessModel === 'marketplace_hybrid'
      && marketplace?.isGeniusEligible !== true
      && marketplace?.overrideShippingFee == null;

    if (isDynamicBulky || isUnknown3PShipping) {
      const shippingReason = isDynamicBulky
        ? 'Calculat la checkout (greutate/volum)'
        : 'Vânzător 3P — verifică transportul în coș';
      return {
        originalPrice: validPrice,
        discountedPrice,
        appliedVoucherPercent,
        shippingState: 'unknown_checkout',
        shippingFee: null,
        shippingReason,
        effectiveDeliveryType,
        rambursFee,
        rambursAvailable,
        rambursWarning,
        rambursNonRefundable,
        totalCost: round2(discountedPrice + rambursFee),
        is3PWarning,
      };
    }

    // Known shipping fee calculation
    let baseFee = marketplace?.sellerType === '3p' && marketplace?.overrideShippingFee != null
      ? Number(marketplace.overrideShippingFee)
      : Number(channel?.fee ?? 0);

    const freeThreshold = marketplace?.overrideFreeThreshold != null
      ? Number(marketplace.overrideFreeThreshold)
      : (channel?.freeThreshold != null ? Number(channel.freeThreshold) : null);

    const rambursDisablesFree = paymentMethod === 'ramburs' && rambursAvailable && Boolean(ramburs.disablesFreeShipping);
    const exceedsFreeWeight = offerWeightKg != null && channel?.freeMaxWeightKg != null && offerWeightKg > Number(channel.freeMaxWeightKg);

    let shippingFee = round2(baseFee);
    let shippingReason = fallbackNote || (
      effectiveDeliveryType === 'clickAndCollect'
        ? (channel?.label || 'Ridicare din magazin')
        : effectiveDeliveryType === 'easybox' || effectiveDeliveryType === 'fanbox'
          ? 'Livrare locker / easybox'
          : 'Curier la ușă'
    );

    if (baseFee === 0 || freeThreshold === 0) {
      shippingFee = 0;
      shippingReason = effectiveDeliveryType === 'clickAndCollect'
        ? (channel?.label || 'Ridicare gratuită din magazin')
        : 'Transport gratuit standard';
    } else if (rambursDisablesFree) {
      shippingFee = round2(baseFee);
      shippingReason = 'Ramburs dezactivează transportul gratuit';
    } else if (!exceedsFreeWeight && freeThreshold != null && discountedPrice >= freeThreshold) {
      shippingFee = 0;
      shippingReason = `Gratuit (peste ${freeThreshold} lei)`;
    } else {
      const membershipReason = evaluateMembershipFreeShipping({
        shipping,
        businessModel,
        marketplace,
        effectiveDeliveryType,
        discountedPrice,
        memberships,
      });
      if (membershipReason) {
        shippingFee = 0;
        shippingReason = membershipReason;
      }
    }

    return {
      originalPrice: validPrice,
      discountedPrice,
      appliedVoucherPercent,
      shippingState: 'known',
      shippingFee,
      shippingReason,
      effectiveDeliveryType,
      rambursFee,
      rambursAvailable,
      rambursWarning,
      rambursNonRefundable,
      totalCost: round2(discountedPrice + shippingFee + rambursFee),
      is3PWarning,
    };
  }

  function stockRank(offer) {
    const state = offer?.stock?.verificationState;
    if (state === 'verified_in_stock') return 0;
    if (state === 'verified_out_of_stock') return 2;
    return 1; // unverified_unknown or missing
  }

  function variantRank(offer) {
    const bucket = offer?.variantBucket || 'exact_variant';
    if (bucket === 'exact_variant') return 0;
    if (bucket === 'unverified_variant') return 1;
    return 2;
  }

  function shippingRank(offer) {
    return offer?.shippingState === 'unknown_checkout' ? 1 : 0;
  }

  function compareOffers(a, b) {
    const sDiff = stockRank(a) - stockRank(b);
    if (sDiff !== 0) return sDiff;

    const vDiff = variantRank(a) - variantRank(b);
    if (vDiff !== 0) return vDiff;

    const shDiff = shippingRank(a) - shippingRank(b);
    if (shDiff !== 0) return shDiff;

    return (a.totalCost || 0) - (b.totalCost || 0);
  }

  /**
   * Project costs and rank offers into exactOffers vs otherVariantOffers.
   */
  function rankOffers(offers, options = {}) {
    const list = Array.isArray(offers) ? offers : [];
    const exactOffers = [];
    const otherVariantOffers = [];

    for (const offer of list) {
      const costs = calculateOfferCosts(offer, options);
      const enriched = { ...offer, ...costs, costs };
      if (offer?.variantBucket === 'different_variant') {
        otherVariantOffers.push(enriched);
      } else {
        exactOffers.push(enriched);
      }
    }

    exactOffers.sort(compareOffers);
    otherVariantOffers.sort(compareOffers);

    const inStockOffers = exactOffers.filter((o) => o.stock?.verificationState === 'verified_in_stock');
    const inStockCount = inStockOffers.length;
    const bestDeal = exactOffers[0] || null;

    const comparable = exactOffers.filter(
      (o) => o.stock?.verificationState !== 'verified_out_of_stock' && o.shippingState !== 'unknown_checkout'
    );
    const savingsPool = comparable.length >= 2
      ? comparable
      : exactOffers.filter((o) => o.stock?.verificationState !== 'verified_out_of_stock');

    let maxSavings = 0;
    if (bestDeal && savingsPool.length > 1) {
      const highest = savingsPool[savingsPool.length - 1];
      maxSavings = Math.max(0, round2(highest.totalCost - bestDeal.totalCost));
    }

    return {
      exactOffers,
      otherVariantOffers,
      bestDeal,
      maxSavings,
      inStockCount,
    };
  }

  /**
   * Compare a pasted sourceOffer against bestDeal using identical landed cost options.
   */
  function computeSourceComparison(sourceOffer, bestDeal, options = {}) {
    if (!sourceOffer || !bestDeal) return null;
    const price = Number(sourceOffer.rawPrice ?? sourceOffer.price ?? sourceOffer.originalPrice ?? 0);
    if (!Number.isFinite(price) || price <= 0) return null;

    const sourceCosts = calculateOfferCosts(sourceOffer, options);
    const sourceTotalCost = sourceCosts.totalCost;
    const savingsVsSource = round2(sourceTotalCost - bestDeal.totalCost);

    return {
      sourceTotalCost,
      savingsVsSource,
      isSourceBest: sourceTotalCost <= bestDeal.totalCost,
    };
  }

  return {
    SIZED_CATEGORIES,
    calculateOfferCosts,
    rankOffers,
    computeSourceComparison,
  };
}));
