'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SIZED_CATEGORIES,
  calculateOfferCosts,
  rankOffers,
  computeSourceComparison,
} = require('../public/cost-calculator');

function makeEmagStoreProfile() {
  return {
    businessModel: 'marketplace_hybrid',
    shippingProfile: {
      bulkyPolicy: 'surcharge_or_excluded',
      channels: {
        easybox: { available: true, fee: 14.99, freeThreshold: 200 },
        courier: { available: true, fee: 19.99, freeThreshold: 200 },
        clickAndCollect: { available: true, fee: 0, freeThreshold: 0 },
      },
      membershipProgram: {
        programId: 'emag_genius',
        lockerFreeThreshold: 30,
        courierFreeThreshold: 100,
      },
    },
    paymentProfile: {
      ramburs: { allowed: true, fee: 5, nonRefundableOnReturn: false, maxOrderRon: 5000 },
    },
  };
}

test('SIZED_CATEGORIES strictly contains shoes and clothes', () => {
  assert.deepEqual(SIZED_CATEGORIES, ['shoes', 'clothes']);
});

test('fail-closed 1P/3P Genius rules deny Genius on unbadged or 3P offers', () => {
  const base = makeEmagStoreProfile();

  // 1P offer >= 30 lei gets Genius Light on easybox
  const offer1p = {
    storeId: 'emag',
    rawPrice: 80,
    ...base,
    marketplace: { sellerType: '1p', isGeniusEligible: true },
  };
  const cost1pEasybox = calculateOfferCosts(offer1p, {
    deliveryType: 'easybox',
    memberships: { emagGenius: 'light' },
  });
  assert.equal(cost1pEasybox.shippingFee, 0);
  assert.equal(cost1pEasybox.totalCost, 80);

  // Genius Light does NOT grant free courier; Genius Premium DOES (>= 100 lei)
  const offer1pCourier = {
    storeId: 'emag',
    rawPrice: 120,
    ...base,
    marketplace: { sellerType: '1p', isGeniusEligible: true },
  };
  assert.equal(
    calculateOfferCosts(offer1pCourier, { deliveryType: 'courier', memberships: { emagGenius: 'light' } }).shippingFee,
    19.99
  );
  assert.equal(
    calculateOfferCosts(offer1pCourier, { deliveryType: 'courier', memberships: { emagGenius: 'premium' } }).shippingFee,
    0
  );

  // 3P seller WITHOUT Genius badge fails closed: no Genius and unknown_checkout if no overrideShippingFee
  const offer3pNoGenius = {
    storeId: 'emag',
    rawPrice: 120,
    ...base,
    marketplace: { sellerType: '3p', isGeniusEligible: false },
  };
  const res3p = calculateOfferCosts(offer3pNoGenius, {
    deliveryType: 'easybox',
    memberships: { emagGenius: 'premium' },
  });
  assert.equal(res3p.shippingState, 'unknown_checkout');
  assert.equal(res3p.shippingFee, null);
  assert.equal(res3p.is3PWarning, true);

  // Marketplace hybrid with missing marketplace metadata (isGeniusEligible !== true) also fails closed
  const offerUnknownSeller = {
    storeId: 'emag',
    rawPrice: 80,
    ...base,
  };
  const resUnknown = calculateOfferCosts(offerUnknownSeller, {
    deliveryType: 'easybox',
    memberships: { emagGenius: 'premium' },
  });
  assert.equal(resUnknown.shippingFee, 14.99);
});

test('PC Garage disables free shipping on ramburs and requires online pay for easybox', () => {
  const pcgOffer = {
    storeId: 'pcgarage',
    rawPrice: 650,
    businessModel: '1p',
    shippingProfile: {
      channels: {
        easybox: { available: true, fee: 14.99, freeThreshold: 500, requiresOnlinePay: true },
        courier: { available: true, fee: 19.99, freeThreshold: 500, freeMaxWeightKg: 7 },
      },
    },
    paymentProfile: {
      ramburs: { allowed: true, fee: 12, disablesFreeShipping: true, maxOrderRon: 5000 },
    },
  };

  // Online card on courier >= 500 lei -> free shipping
  const cardCourier = calculateOfferCosts(pcgOffer, { deliveryType: 'courier', paymentMethod: 'card' });
  assert.equal(cardCourier.shippingFee, 0);
  assert.equal(cardCourier.totalCost, 650);

  // Ramburs on courier disables free shipping + adds 12 lei ramburs fee
  const rambursCourier = calculateOfferCosts(pcgOffer, { deliveryType: 'courier', paymentMethod: 'ramburs' });
  assert.equal(rambursCourier.shippingFee, 19.99);
  assert.equal(rambursCourier.rambursFee, 12);
  assert.equal(rambursCourier.totalCost, 681.99);

  // Easybox with ramburs warns online pay required
  const rambursEasybox = calculateOfferCosts(pcgOffer, { deliveryType: 'easybox', paymentMethod: 'ramburs' });
  assert.equal(rambursEasybox.rambursAvailable, false);
  assert.equal(rambursEasybox.rambursFee, 0);
  assert.ok(rambursEasybox.rambursWarning);
});

test('dynamic_checkout_only bulky policy, Trendyol non-refundable ramburs, and store-scoped voucher', () => {
  const dedemanOffer = {
    storeId: 'dedeman',
    rawPrice: 400,
    businessModel: '1p',
    shippingProfile: {
      bulkyPolicy: 'dynamic_checkout_only',
      channels: {
        courier: { available: true, fee: 0, freeThreshold: null },
      },
    },
    paymentProfile: {
      ramburs: { allowed: true, fee: 5 },
    },
  };
  const dedemanCost = calculateOfferCosts(dedemanOffer, { deliveryType: 'courier', paymentMethod: 'card' });
  assert.equal(dedemanCost.shippingState, 'unknown_checkout');
  assert.equal(dedemanCost.shippingFee, null);
  assert.equal(dedemanCost.totalCost, 400);

  const trendyolOffer = {
    storeId: 'trendyol',
    rawPrice: 100,
    businessModel: 'marketplace_pure',
    shippingProfile: {
      channels: {
        easybox: { available: true, fee: 9.99, freeThreshold: 150 },
      },
    },
    paymentProfile: {
      ramburs: { allowed: true, fee: 19.99, nonRefundableOnReturn: true, maxOrderRon: 2000 },
    },
  };
  const trCost = calculateOfferCosts(trendyolOffer, {
    deliveryType: 'easybox',
    paymentMethod: 'ramburs',
    voucherPercent: 20,
    voucherStoreId: 'trendyol',
  });
  assert.equal(trCost.discountedPrice, 80);
  assert.equal(trCost.shippingFee, 9.99);
  assert.equal(trCost.rambursFee, 19.99);
  assert.equal(trCost.rambursNonRefundable, true);
  assert.equal(trCost.totalCost, 109.98);

  // Store-scoped voucher does NOT apply to a different store
  const trCostOtherVoucher = calculateOfferCosts(trendyolOffer, {
    deliveryType: 'easybox',
    paymentMethod: 'card',
    voucherPercent: 20,
    voucherStoreId: 'fashiondays',
  });
  assert.equal(trCostOtherVoucher.discountedPrice, 100);
});

test('rankOffers sorts by stock state -> variant -> shipping certainty -> totalCost and computes source comparison', () => {
  const offers = [
    {
      storeId: 'dedeman',
      rawPrice: 180,
      businessModel: '1p',
      variantBucket: 'exact_variant',
      stock: { verificationState: 'verified_in_stock' },
      shippingProfile: { bulkyPolicy: 'dynamic_checkout_only', channels: { courier: { available: true, fee: 0 } } },
    },
    {
      storeId: 'altex',
      rawPrice: 200,
      businessModel: '1p',
      variantBucket: 'exact_variant',
      stock: { verificationState: 'verified_in_stock' },
      shippingProfile: { channels: { easybox: { available: true, fee: 9.9, freeThreshold: 400 } } },
    },
    {
      storeId: 'flanco',
      rawPrice: 150,
      businessModel: '1p',
      variantBucket: 'exact_variant',
      stock: { verificationState: 'unverified_unknown' },
      shippingProfile: { channels: { easybox: { available: true, fee: 12.9, freeThreshold: 250 } } },
    },
    {
      storeId: 'vexio',
      rawPrice: 120,
      businessModel: '1p',
      variantBucket: 'different_variant',
      stock: { verificationState: 'verified_in_stock' },
      shippingProfile: { channels: { easybox: { available: true, fee: 14.9, freeThreshold: 500 } } },
    },
    {
      storeId: 'evomag',
      rawPrice: 100,
      businessModel: '1p',
      variantBucket: 'exact_variant',
      stock: { verificationState: 'verified_out_of_stock' },
      shippingProfile: { channels: { easybox: { available: true, fee: 11.99, freeThreshold: 1499 } } },
    },
  ];

  const ranked = rankOffers(offers, { deliveryType: 'easybox', paymentMethod: 'card' });
  assert.equal(ranked.inStockCount, 2);
  assert.equal(ranked.otherVariantOffers.length, 1);
  assert.equal(ranked.otherVariantOffers[0].storeId, 'vexio');
  assert.equal(ranked.exactOffers.length, 4);
  // verified_in_stock + known shipping (altex) beats verified_in_stock + unknown_checkout (dedeman), unverified (flanco), and OOS (evomag)
  assert.equal(ranked.bestDeal.storeId, 'altex');
  assert.equal(ranked.bestDeal.totalCost, 209.9);
  assert.equal(ranked.exactOffers[1].storeId, 'dedeman');
  assert.equal(ranked.exactOffers[2].storeId, 'flanco');
  assert.equal(ranked.exactOffers[3].storeId, 'evomag');

  const cmp = computeSourceComparison(
    {
      storeId: 'flanco',
      rawPrice: 240,
      businessModel: '1p',
      shippingProfile: { channels: { easybox: { available: true, fee: 12.9, freeThreshold: 250 } } },
    },
    ranked.bestDeal,
    { deliveryType: 'easybox', paymentMethod: 'card' }
  );
  assert.deepEqual(cmp, {
    sourceTotalCost: 252.9,
    savingsVsSource: 43,
    isSourceBest: false,
  });

  const cmpBest = computeSourceComparison(
    {
      storeId: 'altex',
      rawPrice: 190,
      businessModel: '1p',
      shippingProfile: { channels: { easybox: { available: true, fee: 9.9, freeThreshold: 400 } } },
    },
    ranked.bestDeal,
    { deliveryType: 'easybox', paymentMethod: 'card' }
  );
  assert.deepEqual(cmpBest, {
    sourceTotalCost: 199.9,
    savingsVsSource: -10,
    isSourceBest: true,
  });
});

test('Tei ELITE, Sephora Gold, ramburs max limits, and exact_variant > unverified_variant ranking', () => {
  const teiOffer = {
    storeId: 'farmaciatei',
    rawPrice: 90,
    businessModel: '1p',
    shippingProfile: {
      channels: { easybox: { available: true, fee: 12, freeThreshold: 250 } },
      membershipProgram: { programId: 'farmacia_tei_elite', lockerFreeThreshold: 0 },
    },
  };
  assert.equal(calculateOfferCosts(teiOffer, { deliveryType: 'easybox', memberships: { farmaciaTeiElite: false } }).shippingFee, 12);
  assert.equal(calculateOfferCosts(teiOffer, { deliveryType: 'easybox', memberships: { farmaciaTeiElite: true } }).shippingFee, 0);

  const sephoraOffer = {
    storeId: 'sephora',
    rawPrice: 110,
    businessModel: '1p',
    shippingProfile: {
      channels: { courier: { available: true, fee: 18, freeThreshold: 180 } },
      membershipProgram: { programId: 'sephora_gold' },
    },
  };
  assert.equal(calculateOfferCosts(sephoraOffer, { deliveryType: 'courier', memberships: { sephoraGold: false } }).shippingFee, 18);
  assert.equal(calculateOfferCosts(sephoraOffer, { deliveryType: 'courier', memberships: { sephoraGold: true } }).shippingFee, 0);

  const heavyAltex = {
    storeId: 'altex',
    rawPrice: 1500,
    weightKg: 85,
    businessModel: '1p',
    shippingProfile: { channels: { courier: { available: true, fee: 14.9, freeThreshold: 400 } } },
    paymentProfile: { ramburs: { allowed: true, fee: 0, maxOrderRon: 5000, maxWeightKg: 75 } },
  };
  const rambursHeavy = calculateOfferCosts(heavyAltex, { deliveryType: 'courier', paymentMethod: 'ramburs' });
  assert.equal(rambursHeavy.rambursAvailable, false);
  assert.ok(rambursHeavy.rambursWarning.includes('75 kg'));

  const variantRankRes = rankOffers([
    {
      storeId: 'storeA',
      rawPrice: 100,
      variantBucket: 'unverified_variant',
      stock: { verificationState: 'verified_in_stock' },
      shippingProfile: { channels: { easybox: { available: true, fee: 0, freeThreshold: 0 } } },
    },
    {
      storeId: 'storeB',
      rawPrice: 120,
      variantBucket: 'exact_variant',
      stock: { verificationState: 'verified_in_stock' },
      shippingProfile: { channels: { easybox: { available: true, fee: 0, freeThreshold: 0 } } },
    },
  ]);
  assert.equal(variantRankRes.bestDeal.storeId, 'storeB');
});
