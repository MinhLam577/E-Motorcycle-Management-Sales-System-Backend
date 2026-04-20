export enum LocationType {
  CENTRAL_CITY = 1, // thành phố trực thuộc trung ương
  PROVINCE = 2, // Tỉnh
  CITY = 3, // Thành phố thuộc tỉnh (ví dụ: TP. Huế thuộc Thừa Thiên Huế)
  DISTRICT = 4, // Quận
  TOWN = 5, // Thị xã
  COMMUNE = 6, // Huyện
  WARD = 7, // Phường
}

export enum ProvinceType {
  CENTRAL_CITY = LocationType.CENTRAL_CITY, // Thành phố trực thuộc trung ương
  PROVINCE = LocationType.PROVINCE, // Tỉnh
}

export enum DistrictType {
  CITY = LocationType.CITY, // Thành phố thuộc tỉnh
  DISTRICT = LocationType.DISTRICT, // Quận
  TOWN = LocationType.TOWN, // Thị xã
  COMMUNE = LocationType.COMMUNE, // Huyện
}

export enum WardType {
  WARD = LocationType.WARD, // Phường
}

export enum AddressAPI {
  PROVINCE_API = 'https://provinces.open-api.vn/api/v1/p/',
  DISTRICT_API = 'https://provinces.open-api.vn/api/v1/d/',
  WARD_API = 'https://open.oapi.vn/location/wards',
}
