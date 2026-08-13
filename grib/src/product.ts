import { allOnes, i8sm, i32sm, u8, u16, u32 } from "./bytes.js";

export interface ProductDefinition {
  productDefinitionTemplateNumber: number;
  /** Count of optional coordinate values after the template. */
  numberOfCoordinateValues: number;
  parameterCategory: number;
  parameterNumber: number;
  /** Fields below are absent on templates this module does not parse. */
  typeOfGeneratingProcess?: number;
  /** Raw code table 4.4 unit, never converted. */
  indicatorOfUnitOfTimeRange?: number;
  /** Raw forecast time in indicatorOfUnitOfTimeRange units. */
  forecastTime?: number;
  typeOfFirstFixedSurface?: number;
  scaleFactorOfFirstFixedSurface?: number;
  scaledValueOfFirstFixedSurface?: number;
  typeOfSecondFixedSurface?: number;
  scaleFactorOfSecondFixedSurface?: number;
  scaledValueOfSecondFixedSurface?: number;
  /** Templates 4.1 / 4.11 only. */
  typeOfEnsembleForecast?: number;
  perturbationNumber?: number;
  numberOfForecastsInEnsemble?: number;
}

const TEMPLATES_SHARING_4_0_LAYOUT = new Set([0, 1, 8, 11]);

function missingAsUndefined(value: number, bits: number): number | undefined {
  return value === allOnes(bits) ? undefined : value;
}

/** Parses a raw section 4 (bytes include the 5-octet section header). */
export function parseProduct(section4: Uint8Array): ProductDefinition {
  if (u8(section4, 4) !== 4) {
    throw new Error(`expected GRIB section 4, got section ${u8(section4, 4)}`);
  }
  const template = u16(section4, 7);
  const product: ProductDefinition = {
    productDefinitionTemplateNumber: template,
    numberOfCoordinateValues: u16(section4, 5),
    parameterCategory: u8(section4, 9),
    parameterNumber: u8(section4, 10),
  };
  if (!TEMPLATES_SHARING_4_0_LAYOUT.has(template)) return product;

  product.typeOfGeneratingProcess = u8(section4, 11);
  product.indicatorOfUnitOfTimeRange = u8(section4, 17);
  product.forecastTime = i32sm(section4, 18);
  product.typeOfFirstFixedSurface = missingAsUndefined(u8(section4, 22), 8);
  if (product.typeOfFirstFixedSurface !== undefined) {
    const scaleFactor = u8(section4, 23);
    const scaledValue = u32(section4, 24);
    product.scaleFactorOfFirstFixedSurface =
      scaleFactor === allOnes(8) ? undefined : i8sm(section4, 23);
    product.scaledValueOfFirstFixedSurface = missingAsUndefined(scaledValue, 32);
  }
  product.typeOfSecondFixedSurface = missingAsUndefined(u8(section4, 28), 8);
  if (product.typeOfSecondFixedSurface !== undefined) {
    const scaleFactor = u8(section4, 29);
    const scaledValue = u32(section4, 30);
    product.scaleFactorOfSecondFixedSurface =
      scaleFactor === allOnes(8) ? undefined : i8sm(section4, 29);
    product.scaledValueOfSecondFixedSurface = missingAsUndefined(scaledValue, 32);
  }

  if (template === 1 || template === 11) {
    product.typeOfEnsembleForecast = u8(section4, 34);
    product.perturbationNumber = u8(section4, 35);
    product.numberOfForecastsInEnsemble = u8(section4, 36);
  }
  return product;
}
