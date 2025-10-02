// NDVI region & optionally per-site min/max/mean (flexible)
//
// - Auto-detects years in the Landsat 8 collection between startDate and endDate
// - Set month = null to use full-year median, or set month = 6 (June) etc.
// - Per-site stats only run if 'sites' is provided as a FeatureCollection asset
// - Uses LANDSAT/LC08/C02/T1_L2 and QA_PIXEL cloud masking
//
// Edit the variables in the "USER CONFIG" section as needed.

/////////////////////////////////////////////////////
// USER CONFIG
var roiAsset = 'REPLACE_WITH_YOUR_ROI_ASSET'; // e.g. 'users/yourname/your_asset' OR set roi = ee.FeatureCollection(...) directly
var startDate = '2013-01-01'; // earliest date to search (change if required)
var endDate   = '2024-12-31'; // latest date to search (change if required)
var month = null; // set to 1-12 for a specific month (e.g., 6 for June), or null for whole-year
var years = []; // leave empty array [] to auto-detect years from imagery; OR set e.g. [2013,....,2024]
var sites = null; // OPTIONAL: set to ee.FeatureCollection('projects/.../assets/sites') to run per-site stats
var siteBuffer = 30; // buffer in meters around site points (if sites provided)
/////////////////////////////////////////////////////

Map.centerObject(southern, 9);

// Cloud-mask for Landsat 8 SR
function maskL8sr(image) {
  var qa = image.select('QA_PIXEL');
  var shadowFree = qa.bitwiseAnd(1 << 3).eq(0);
  var cloudFree  = qa.bitwiseAnd(1 << 4).eq(0);
  return image.updateMask(shadowFree.and(cloudFree));
}

// build Landsat collection filtered by ROI & date
var baseColl = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterBounds(southern)
  .filterDate(startDate, endDate)
  .map(maskL8sr);

// if user left years empty, auto-detect distinct years present in the collection
var yearsList;
if (years.length === 0) {
  // aggregate system:time_start, convert to years, distinct & sort
  yearsList = ee.List(baseColl.aggregate_array('system:time_start'))
    .map(function(t){ return ee.Date(t).get('year'); })
    .distinct()
    .sort();
  // pull to client for looping (usually small list). If very large, set years manually.
  years = yearsList.getInfo();
} // else the provided years array will be used

// Visual params (optional)
var ndviVis = {min:-0.1, max:1.0, palette: ['ffffff','c4cec4','97b97f','6aa849','40a02b','207401','015701','003f01','002601'], region: southern.geometry()};

// Combined reducer: min, max, mean
var combinedReducer = ee.Reducer.min()
  .combine({reducer2: ee.Reducer.max(), sharedInputs: true})
  .combine({reducer2: ee.Reducer.mean(), sharedInputs: true});

// iterate years (client-side loop over the JS array)
years.forEach(function(year) {
  year = parseInt(year, 10);

  var coll;
  if (month === null) {
    // whole year median
    var s = ee.Date.fromYMD(year, 1, 1);
    var e = s.advance(1, 'year');
    coll = baseColl.filterDate(s, e).select(['SR_B4','SR_B5']);
  } else {
    var s = ee.Date.fromYMD(year, month, 1);
    var e = s.advance(1, 'month');
    coll = baseColl.filterDate(s, e).select(['SR_B4','SR_B5']);
  }

  // if collection empty skip
  var count = coll.size().getInfo();
  if (count === 0) {
    print('NDVI: Year ' + year + ': no images → skipping');
    return;
  }

  var comp = coll.median().clip(southern);

  // compute NDVI
  var ndvi = comp.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI');

  // add to map for QC
  var label = (month === null) ? (year + ' (year median)') : (year + '-' + (month < 10 ? '0' + month : month));
  Map.addLayer(ndvi, ndviVis, 'NDVI ' + label);

  // region-level min/max/mean
  var regionStats = ndvi.reduceRegion({
    reducer: combinedReducer,
    geometry: southern,
    scale: 30,
    maxPixels: 1e13
  });
  print('--- Region NDVI stats for ' + label + ' ---');
  print(regionStats); // NDVI_min, NDVI_max, NDVI_mean

  // per-site stats (only if sites provided)
  if (sites) {
    var pts = ee.FeatureCollection(sites);
    var ptsBuffered = (siteBuffer > 0) ? pts.map(function(f){ return f.buffer(siteBuffer); }) : pts;

    var stats = ndvi.reduceRegions({
      collection: ptsBuffered,
      reducer: combinedReducer,
      scale: 30
    });

    // standardize properties minimally for readability
    var cleaned = stats.map(function(f){
      f = ee.Feature(f);
      return ee.Feature(f.geometry(), {
         name: f.get('name'),
         year: year,
         NDVI_min: f.get('NDVI_min'),
         NDVI_max: f.get('NDVI_max'),
         NDVI_mean: f.get('NDVI_mean')
      });
    });

    print('Per-site NDVI stats for ' + label + ' (buffer=' + siteBuffer + ' m):', cleaned);
  }
});
// ------------------ Optional: High-quality Export to Google Drive ------------------
  // If getThumbURL fails or you want guaranteed high-res images, uncomment the blocks below,
  // then run the script and start the Exports from the "Tasks" tab in the Code Editor.
  //
  // The exports use image.visualize(...) to produce an RGB PNG using your palette.
  //
  /*
  Export.image.toDrive({
    image: ndvi.visualize({min: ndviVis.min, max: ndviVis.max, palette: ndviVis.palette}),
    description: 'NDVI_' + year + '_PNG',
    folder: 'GEE_exports',
    fileNamePrefix: 'NDVI_' + year + '_PNG',
    region: ndviVis.region,
    scale: 30,            // Landsat native resolution
    maxPixels: 1e13
  });
  */

}); // end years loop
