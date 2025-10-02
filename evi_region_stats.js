// EVI region & optionally per-site min/max/mean (flexible)
//
// - Auto-detects years in the Landsat 8 collection between startDate and endDate
// - Set month = null to use full-year median, or set month = 6 (June) etc.
// - Per-site stats only run if 'sites' is provided as a FeatureCollection asset
// - Uses LANDSAT/LC08/C02/T1_L2 and QA_PIXEL cloud masking
//
// Edit the variables in the "USER CONFIG" section as needed.

/////////////////////////////////////////////////////
// USER CONFIG
var southern = ee.FeatureCollection("projects/ee-muhdfarooq4/assets/Southern"); // ROI asset
var startDate = '2013-01-01'; // earliest date to search (change if required)
var endDate   = '2024-12-31'; // latest date to search (change if required)
var month = null; // set to 1-12 for a specific month (e.g., 6 for June), or null for whole-year
var years = []; // leave empty array [] to auto-detect years from imagery; OR set e.g. [2013,2019,2024]
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
  yearsList = ee.List(baseColl.aggregate_array('system:time_start'))
    .map(function(t){ return ee.Date(t).get('year'); })
    .distinct()
    .sort();
  years = yearsList.getInfo();
} // else the provided years array will be used

// Visual params for EVI (optional)
var visEVI  = {min:-1, max:1, palette: ['8b4513','d2691e','f4a460','ffd700','adff2f','7cfc00','00ff00','008000','006400'], region: southern.geometry()};

// Combined reducer: min, max, mean
var combinedReducer = ee.Reducer.min()
  .combine({reducer2: ee.Reducer.max(), sharedInputs: true})
  .combine({reducer2: ee.Reducer.mean(), sharedInputs: true});

// EVI expression (robust)
function calcEVI(img) {
  var NIR = img.select('SR_B5');
  var RED = img.select('SR_B4');
  var BLUE= img.select('SR_B2');
  var numerator = NIR.subtract(RED).multiply(2.5);
  var denominator = NIR.add(RED.multiply(6.0)).subtract(BLUE.multiply(7.5)).add(1.0);
  var evi = numerator.divide(denominator).rename('EVI');
  // clamp between -1 and 1
  return evi.max(ee.Image.constant(-1)).min(ee.Image.constant(1));
}

// iterate years (client-side loop over the JS array)
years.forEach(function(year) {
  year = parseInt(year, 10);

  var coll;
  if (month === null) {
    // whole year median
    var s = ee.Date.fromYMD(year, 1, 1);
    var e = s.advance(1, 'year');
    coll = baseColl.filterDate(s, e).select(['SR_B2','SR_B4','SR_B5']);
  } else {
    var s = ee.Date.fromYMD(year, month, 1);
    var e = s.advance(1, 'month');
    coll = baseColl.filterDate(s, e).select(['SR_B2','SR_B4','SR_B5']);
  }

  var count = coll.size().getInfo();
  if (count === 0) {
    print('EVI: Year ' + year + ': no images → skipping');
    return;
  }

  var comp = coll.median().clip(southern);

  // compute EVI
  var evi = calcEVI(comp);

  // add to map for QC
  var label = (month === null) ? (year + ' (year median)') : (year + '-' + (month < 10 ? '0' + month : month));
  Map.addLayer(evi, visEVI, 'EVI ' + label);

  // region-level min/max/mean
  var regionStats = evi.reduceRegion({
    reducer: combinedReducer,
    geometry: southern,
    scale: 30,
    maxPixels: 1e13
  });
  print('--- Region EVI stats for ' + label + ' ---');
  print(regionStats); // EVI_min, EVI_max, EVI_mean

  // per-site stats (only if sites provided)
  if (sites) {
    var pts = ee.FeatureCollection(sites);
    var ptsBuffered = (siteBuffer > 0) ? pts.map(function(f){ return f.buffer(siteBuffer); }) : pts;

    var stats = evi.reduceRegions({
      collection: ptsBuffered,
      reducer: combinedReducer,
      scale: 30
    });

    var cleaned = stats.map(function(f){
      f = ee.Feature(f);
      return ee.Feature(f.geometry(), {
         name: f.get('name'),
         year: year,
         EVI_min: f.get('EVI_min'),
         EVI_max: f.get('EVI_max'),
         EVI_mean: f.get('EVI_mean')
      });
    });

    print('Per-site EVI stats for ' + label + ' (buffer=' + siteBuffer + ' m):', cleaned);
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
    image: evi.visualize({min: visEVI.min, max: visEVI.max, palette: visEVI.palette}),
    description: 'EVI_' + year + '_PNG',
    folder: 'GEE_exports',
    fileNamePrefix: 'EVI_' + year + '_PNG',
    region: visEVI.region,
    scale: 30,
    maxPixels: 1e13
  });
  */

}); // end years loop
